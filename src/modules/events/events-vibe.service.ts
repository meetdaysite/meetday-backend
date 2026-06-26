import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OrderStatus, VibeType, SocialStyle, InterestAffinity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { GraphService } from '../graph/graph.service';
import { InterestAffinityInputDto, VibeMatchDto } from './dto/vibe-match.dto';
import {
  CROWD_CONFIDENCE_N0,
  DOMINANT_MARGIN,
  ENERGY_THRESHOLD,
  GRAPH_SATURATION_K,
  INTEREST_FIT_UNKNOWN,
  MATCH_WEIGHTS_ANON,
  MATCH_WEIGHTS_AUTH,
  MIN_SAMPLE_FOR_DOMINANT,
  MIN_SAMPLE_FOR_LABEL,
  VIBE_SMOOTHING_ALPHA,
} from './vibe.constants';

interface CrowdPulseCache {
  energy: 'HIGH' | 'MEDIUM' | 'LOW';
  dominantVibeType: VibeType | null;
  crowdStyle: string;
  socialFriendliness: string;
  totalAttendees: number;
  sampleSize: number; // attendees with a non-null vibeType
  confidence: number; // 0..1, scales with sampleSize
  isEstimate: boolean; // true when sampleSize is too low for confident labels
  computedAt: string;
}

@Injectable()
export class EventsVibeService {
  private readonly logger = new Logger(EventsVibeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly graphService: GraphService,
  ) {}

  // ─── Public API ──────────────────────────────────────────────────────────────

  async getVibeMatch(eventId: string, dto: VibeMatchDto, userId?: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, categoryId: true, crowdPulse: true },
    });
    if (!event) throw new NotFoundException('Event not found');

    // Graph proximity is only available for an authenticated caller.
    const proximity = userId
      ? await this.graphService.getProximityForScore(userId, eventId)
      : null;
    const hasProximity = (proximity?.knownAttendeeCount ?? 0) > 0;

    const hasInput = dto.vibeType || dto.socialStyle || dto.interests?.length;
    // With neither questionnaire answers nor any known co-attendees there is
    // nothing to score on — keep the "answer the questions" prompt.
    if (!hasInput && !hasProximity) {
      return {
        score: null,
        reasons: [],
        similarAttendees: { count: 0, avatars: [] },
        socialProximity: proximity ?? null,
        prompt: 'Answer the questions to see your vibe match',
      };
    }

    const crowdPulse = event.crowdPulse as unknown as CrowdPulseCache | null;
    const crowdConfidence = crowdPulse?.confidence ?? 0;

    // Fetch interest IDs linked to this event's category
    const categoryInterestIds = event.categoryId
      ? (
          await this.prisma.interestCategory.findMany({
            where: { categoryId: event.categoryId },
            select: { interestId: true },
          })
        ).map((r) => r.interestId)
      : [];
    const categoryInterestSet = new Set(categoryInterestIds);

    // ── Normalised sub-scores in [0,1] ──
    const interestFit = this.interestFit(dto.interests ?? [], categoryInterestSet);
    const vibeFitRaw = this.vibeFit(dto.vibeType ?? null, crowdPulse?.dominantVibeType ?? null);
    // Pull vibe fit toward neutral when we have little crowd data — don't claim
    // strong alignment off a noisy dominant vibe.
    const vibeFit = 0.5 + crowdConfidence * (vibeFitRaw - 0.5);
    const socialFit = this.socialFit(dto.socialStyle ?? null);
    const graphFit = this.graphFit(proximity?.knownAttendeeCount ?? 0);

    const score = this.combineScore({ interestFit, vibeFit, socialFit, graphFit }, userId !== undefined);

    // Derive matched interests for reasons
    const likedMatched = (dto.interests ?? []).filter(
      (i) => i.affinity === 'LIKED' && categoryInterestSet.has(i.interestId),
    );
    const dislikedMatched = (dto.interests ?? []).filter(
      (i) => i.affinity === 'DISLIKED' && categoryInterestSet.has(i.interestId),
    );

    let matchedInterestNames: string[] = [];
    let similarCount = 0;

    if (likedMatched.length > 0) {
      const interests = await this.prisma.interest.findMany({
        where: { id: { in: likedMatched.map((i) => i.interestId) } },
        select: { name: true },
      });
      matchedInterestNames = interests.map((i) => i.name);
      similarCount = await this.countSimilarAttendees(eventId, likedMatched.map((i) => i.interestId));
    }

    const reasons = this.buildReasons(
      { interestFit, vibeFit, socialFit, graphFit },
      dto,
      matchedInterestNames,
      dislikedMatched.length > 0,
      similarCount,
      crowdPulse,
      proximity,
    );
    const similarAttendees = await this.getSimilarAttendeeAvatars(
      eventId,
      likedMatched.map((i) => i.interestId),
    );

    return { score, reasons, similarAttendees, socialProximity: proximity ?? null };
  }

  async getCrowdPulse(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, crowdPulse: true },
    });
    if (!event) throw new NotFoundException('Event not found');

    let pulse = event.crowdPulse as unknown as CrowdPulseCache | null;
    if (!pulse || pulse.confidence == null) {
      pulse = await this.computeAndStoreCrowdPulse(eventId);
    }

    const avatars = await this.getTopAttendeeAvatars(eventId);

    return {
      totalAttendees: pulse.totalAttendees,
      energy: pulse.energy,
      crowdStyle: pulse.crowdStyle,
      socialFriendliness: pulse.socialFriendliness,
      confidence: pulse.confidence ?? 0,
      isEstimate: pulse.isEstimate ?? true,
      topAttendeeAvatars: avatars,
    };
  }

  async recomputeCrowdPulse(eventId: string): Promise<void> {
    try {
      await this.computeAndStoreCrowdPulse(eventId);
    } catch (err) {
      this.logger.error(`Failed to recompute crowd pulse for event ${eventId}`, err);
    }
  }

  // ─── Crowd Pulse Compute ─────────────────────────────────────────────────────

  private async computeAndStoreCrowdPulse(eventId: string): Promise<CrowdPulseCache> {
    const profiles = await this.prisma.attendeeProfile.findMany({
      where: {
        user: { orders: { some: { eventId, status: OrderStatus.CONFIRMED } } },
      },
      select: { vibeType: true, socialStyle: true },
    });

    const total = profiles.length;

    // VibeType distribution
    const vibeCounts: Record<VibeType, number> = {
      LIFE_OF_PARTY: 0,
      CHILL_OBSERVING: 0,
      HERE_TO_CONNECT: 0,
      OPEN_TO_WHATEVER: 0,
    };
    for (const p of profiles) {
      if (p.vibeType) vibeCounts[p.vibeType]++;
    }
    const n = profiles.filter((p) => p.vibeType).length; // vibe-typed sample size
    const confidence = n / (n + CROWD_CONFIDENCE_N0);
    const isEstimate = n < MIN_SAMPLE_FOR_LABEL;

    // Smoothed proportions — pull toward uniform when the sample is thin, so one
    // or two attendees can't swing the whole label. At n=0 every type is 1/K.
    const K = 4;
    const smoothed = (count: number) => (count + VIBE_SMOOTHING_ALPHA) / (n + VIBE_SMOOTHING_ALPHA * K);

    // Energy: only confident once we clear the minimum sample.
    let energy: CrowdPulseCache['energy'] = 'MEDIUM';
    if (!isEstimate) {
      const partyP = smoothed(vibeCounts.LIFE_OF_PARTY);
      const chillP = smoothed(vibeCounts.CHILL_OBSERVING);
      energy = partyP > ENERGY_THRESHOLD ? 'HIGH' : chillP > ENERGY_THRESHOLD ? 'LOW' : 'MEDIUM';
    }

    const dominantVibeType = this.resolveDominantVibe(vibeCounts, n, smoothed);

    // SocialStyle distribution
    const socialCounts: Record<SocialStyle, number> = {
      SOLO_EXPLORER: 0,
      OPEN_TO_MEETING: 0,
      BRINGING_GANG: 0,
    };
    for (const p of profiles) {
      if (p.socialStyle) socialCounts[p.socialStyle]++;
    }
    const withSocial = profiles.filter((p) => p.socialStyle).length || 1;
    const openToMeetingPct = socialCounts.OPEN_TO_MEETING / withSocial;
    const bringingGangPct = socialCounts.BRINGING_GANG / withSocial;

    const socialFriendliness = isEstimate
      ? 'Friendly'
      : openToMeetingPct > 0.5
        ? 'Very Friendly'
        : bringingGangPct > 0.4
          ? 'Group-Friendly'
          : 'Friendly';

    // Crowd style
    let crowdStyle = 'Mixed Crowd';
    if (!isEstimate) {
      const partyLean = vibeCounts.LIFE_OF_PARTY + socialCounts.BRINGING_GANG;
      const socialLean = vibeCounts.HERE_TO_CONNECT + socialCounts.OPEN_TO_MEETING;
      const chillLean = vibeCounts.CHILL_OBSERVING + socialCounts.SOLO_EXPLORER;
      const maxLean = Math.max(partyLean, socialLean, chillLean);
      crowdStyle =
        maxLean === partyLean ? 'Party Energy' : maxLean === socialLean ? 'Trendy & Social' : 'Laid-back & Chill';
    }

    const pulse: CrowdPulseCache = {
      energy,
      dominantVibeType,
      crowdStyle,
      socialFriendliness,
      totalAttendees: total,
      sampleSize: n,
      confidence,
      isEstimate,
      computedAt: new Date().toISOString(),
    };

    await this.prisma.event.update({ where: { id: eventId }, data: { crowdPulse: pulse as object } });
    return pulse;
  }

  /**
   * Argmax over smoothed vibe proportions, but null when the sample is too small
   * or the top two are within DOMINANT_MARGIN — no false LIFE_OF_PARTY default.
   */
  private resolveDominantVibe(
    vibeCounts: Record<VibeType, number>,
    n: number,
    smoothed: (count: number) => number,
  ): VibeType | null {
    if (n < MIN_SAMPLE_FOR_DOMINANT) return null;

    const ranked = (Object.entries(vibeCounts) as [VibeType, number][])
      .map(([type, count]) => ({ type, p: smoothed(count) }))
      .sort((a, b) => b.p - a.p);

    if (ranked.length < 2 || ranked[0].p - ranked[1].p < DOMINANT_MARGIN) return null;
    return ranked[0].type;
  }

  // ─── Score helpers ───────────────────────────────────────────────────────────

  /**
   * Interest fit in [0,1] — rewards the *quality* of matched interests, not the
   * count, so adding more answers can't inflate the score. Averages per-interest
   * contributions (LIKED +1, OPEN_TO +0.5, DISLIKED -1) over the interests the
   * user rated that belong to this category, then maps [-1,1] → [0,1].
   */
  private interestFit(interests: InterestAffinityInputDto[], categorySet: Set<string>): number {
    const matched = interests.filter((i) => categorySet.has(i.interestId));
    if (matched.length === 0) return INTEREST_FIT_UNKNOWN;

    const contribution = (a: InterestAffinity) => (a === 'LIKED' ? 1 : a === 'OPEN_TO' ? 0.5 : -1);
    const avg = matched.reduce((sum, i) => sum + contribution(i.affinity), 0) / matched.length;
    return (avg + 1) / 2;
  }

  /** Vibe fit in [0,1] — user vibe vs crowd dominant vibe (pre-confidence-weighting). */
  private vibeFit(vibeType: VibeType | null, dominantCrowd: VibeType | null): number {
    if (!vibeType || !dominantCrowd) return 0.5;
    if (vibeType === dominantCrowd) return 1;
    if (vibeType === 'OPEN_TO_WHATEVER') return 0.8;
    const compatible: Partial<Record<VibeType, VibeType[]>> = {
      LIFE_OF_PARTY: ['HERE_TO_CONNECT'],
      HERE_TO_CONNECT: ['LIFE_OF_PARTY', 'OPEN_TO_WHATEVER'],
      CHILL_OBSERVING: ['OPEN_TO_WHATEVER'],
    };
    if (compatible[vibeType]?.includes(dominantCrowd)) return 0.6;
    return 0.3;
  }

  /** Social fit in [0,1] — the user's own openness to meeting people. */
  private socialFit(socialStyle: SocialStyle | null): number {
    if (socialStyle === 'OPEN_TO_MEETING') return 1;
    if (socialStyle === 'BRINGING_GANG') return 0.66;
    return 0.5; // SOLO_EXPLORER or unstated
  }

  /** Graph proximity in [0,1] — saturating in known co-attendees (diminishing returns). */
  private graphFit(knownAttendees: number): number {
    return 1 - Math.exp(-GRAPH_SATURATION_K * knownAttendees);
  }

  /**
   * Weighted combination → 0–100, rounded to 5. Graph proximity carries the most
   * weight when authenticated (behavioural truth); when anonymous the remaining
   * three weights are renormalised. No floor — poor fits are allowed to score low.
   */
  private combineScore(
    parts: { interestFit: number; vibeFit: number; socialFit: number; graphFit: number },
    authenticated: boolean,
  ): number {
    const raw = authenticated
      ? MATCH_WEIGHTS_AUTH.interest * parts.interestFit +
        MATCH_WEIGHTS_AUTH.vibe * parts.vibeFit +
        MATCH_WEIGHTS_AUTH.social * parts.socialFit +
        MATCH_WEIGHTS_AUTH.graph * parts.graphFit
      : MATCH_WEIGHTS_ANON.interest * parts.interestFit +
        MATCH_WEIGHTS_ANON.vibe * parts.vibeFit +
        MATCH_WEIGHTS_ANON.social * parts.socialFit;

    const clamped = Math.max(0, Math.min(100, raw * 100));
    return Math.round(clamped / 5) * 5;
  }

  // ─── Reasons ────────────────────────────────────────────────────────────────

  private buildReasons(
    parts: { interestFit: number; vibeFit: number; socialFit: number; graphFit: number },
    dto: VibeMatchDto,
    matchedInterestNames: string[],
    hasDislikedMatch: boolean,
    similarCount: number,
    crowdPulse: CrowdPulseCache | null,
    proximity: { knownAttendeeCount: number; strongestTies: { firstName: string }[] } | null,
  ) {
    // SHARED_INTERESTS
    let sharedDesc: string;
    if (matchedInterestNames.length > 0) {
      const names = matchedInterestNames.slice(0, 2).join(', ');
      sharedDesc = `You and ${similarCount} others like ${names}`;
    } else if (hasDislikedMatch) {
      sharedDesc = 'Some aspects of this event may not be your usual scene';
    } else {
      sharedDesc = "This event is in a category you haven't explored yet";
    }

    // ROOM_FIT
    const roomDesc =
      dto.socialStyle === 'OPEN_TO_MEETING'
        ? 'This crowd loves meeting new people'
        : dto.socialStyle === 'BRINGING_GANG'
          ? 'Bring your squad — groups are welcome here'
          : dto.socialStyle === 'SOLO_EXPLORER'
            ? 'Great for solo explorers — low pressure crowd'
            : 'A welcoming crowd for everyone';

    // ENERGY_ALIGNMENT
    const energy = crowdPulse?.energy ?? null;
    let energyDesc: string;
    if (!dto.vibeType) {
      energyDesc = 'A diverse crowd with different energies';
    } else if (dto.vibeType === 'LIFE_OF_PARTY' && energy === 'HIGH') {
      energyDesc = 'High-energy set, perfect for letting go';
    } else if (dto.vibeType === 'HERE_TO_CONNECT') {
      energyDesc = 'A social crowd ready to connect';
    } else if (dto.vibeType === 'CHILL_OBSERVING' && energy === 'LOW') {
      energyDesc = 'Relaxed pace — no pressure to perform';
    } else if (dto.vibeType === 'OPEN_TO_WHATEVER') {
      energyDesc = 'Flexible crowd — come as you are';
    } else {
      energyDesc = 'A diverse crowd with different energies';
    }

    const reasons = [
      { type: 'SHARED_INTERESTS', label: 'Shared Interests', description: sharedDesc, weight: parts.interestFit },
      { type: 'ROOM_FIT', label: 'Room fit', description: roomDesc, weight: parts.socialFit },
      { type: 'ENERGY_ALIGNMENT', label: 'Energy alignment', description: energyDesc, weight: parts.vibeFit },
    ];

    // SOCIAL_PROXIMITY — only when the caller actually has known co-attendees.
    const known = proximity?.knownAttendeeCount ?? 0;
    if (known > 0) {
      const names = (proximity?.strongestTies ?? []).slice(0, 2).map((t) => t.firstName);
      const desc =
        names.length > 0
          ? `${names.join(' and ')}${known > names.length ? ` +${known - names.length} more` : ''} you've crossed paths with ${known === 1 ? 'is' : 'are'} going`
          : `${known} ${known === 1 ? 'person' : 'people'} you've crossed paths with ${known === 1 ? 'is' : 'are'} going`;
      reasons.push({ type: 'SOCIAL_PROXIMITY', label: 'Your people', description: desc, weight: parts.graphFit });
    }

    // Lead with the strongest-contributing dimension; drop the internal weight.
    return reasons
      .sort((a, b) => b.weight - a.weight)
      .map(({ weight, ...reason }) => reason);
  }

  // ─── Attendee helpers ────────────────────────────────────────────────────────

  private async getVisibleAttendeeIds(eventId: string): Promise<string[]> {
    const orders = await this.prisma.order.findMany({
      where: { eventId, status: OrderStatus.CONFIRMED },
      select: { userId: true },
    });
    const allIds = orders.map((o) => o.userId);

    const privateProfiles = await this.prisma.attendeeProfile.findMany({
      where: { userId: { in: allIds }, privacy: 'PRIVATE' },
      select: { userId: true },
    });
    const privateSet = new Set(privateProfiles.map((p) => p.userId));

    return allIds.filter((id) => !privateSet.has(id));
  }

  private async countSimilarAttendees(eventId: string, likedInterestIds: string[]): Promise<number> {
    const visibleIds = await this.getVisibleAttendeeIds(eventId);
    if (visibleIds.length === 0) return 0;

    const rows = await this.prisma.userInterestAffinity.groupBy({
      by: ['userId'],
      where: {
        userId: { in: visibleIds },
        interestId: { in: likedInterestIds },
        affinity: 'LIKED',
      },
    });
    return rows.length;
  }

  private async getSimilarAttendeeAvatars(eventId: string, likedInterestIds: string[]) {
    const visibleIds = await this.getVisibleAttendeeIds(eventId);

    let matchedIds: string[];
    if (likedInterestIds.length > 0 && visibleIds.length > 0) {
      const rows = await this.prisma.userInterestAffinity.groupBy({
        by: ['userId'],
        where: {
          userId: { in: visibleIds },
          interestId: { in: likedInterestIds },
          affinity: 'LIKED',
        },
      });
      matchedIds = rows.map((r) => r.userId);
    } else {
      matchedIds = visibleIds;
    }

    const count = matchedIds.length;
    const topIds = matchedIds.slice(0, 5);

    const users = await this.prisma.user.findMany({
      where: { id: { in: topIds }, avatarUrl: { not: null } },
      select: { avatarUrl: true },
    });

    const avatars = (
      await Promise.all(
        users.map((u) => this.storageService.getPresignedDownloadUrl(u.avatarUrl!).catch(() => null)),
      )
    ).filter((url): url is string => url !== null);

    return { count, avatars };
  }

  private async getTopAttendeeAvatars(eventId: string): Promise<string[]> {
    const visibleIds = await this.getVisibleAttendeeIds(eventId);
    const topIds = visibleIds.slice(0, 5);

    const users = await this.prisma.user.findMany({
      where: { id: { in: topIds }, avatarUrl: { not: null } },
      select: { avatarUrl: true },
    });

    return (
      await Promise.all(
        users.map((u) => this.storageService.getPresignedDownloadUrl(u.avatarUrl!).catch(() => null)),
      )
    ).filter((url): url is string => url !== null);
  }
}
