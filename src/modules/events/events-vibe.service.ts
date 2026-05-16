import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OrderStatus, VibeType, SocialStyle } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { InterestAffinityInputDto, VibeMatchDto } from './dto/vibe-match.dto';

interface CrowdPulseCache {
  energy: 'HIGH' | 'MEDIUM' | 'LOW';
  dominantVibeType: VibeType | null;
  crowdStyle: string;
  socialFriendliness: string;
  totalAttendees: number;
  computedAt: string;
}

@Injectable()
export class EventsVibeService {
  private readonly logger = new Logger(EventsVibeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  // ─── Public API ──────────────────────────────────────────────────────────────

  async getVibeMatch(eventId: string, dto: VibeMatchDto) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, categoryId: true, crowdPulse: true },
    });
    if (!event) throw new NotFoundException('Event not found');

    const hasInput = dto.vibeType || dto.socialStyle || dto.interests?.length;
    if (!hasInput) {
      return {
        score: null,
        reasons: [],
        similarAttendees: { count: 0, avatars: [] },
        prompt: 'Answer the questions to see your vibe match',
      };
    }

    const crowdPulse = event.crowdPulse as unknown as CrowdPulseCache | null;

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

    // Score each dimension
    const interestScore = this.computeInterestScore(dto.interests ?? [], categoryInterestSet);
    const vibeScore = this.computeVibeScore(dto.vibeType ?? null, crowdPulse?.dominantVibeType ?? null);
    const socialScore = this.computeSocialScore(dto.socialStyle ?? null);

    const rawScore = interestScore + vibeScore + socialScore;
    const clamped = Math.max(10, Math.min(100, rawScore));
    const score = Math.round(clamped / 5) * 5;

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
      dto,
      matchedInterestNames,
      dislikedMatched.length > 0,
      similarCount,
      crowdPulse,
    );
    const similarAttendees = await this.getSimilarAttendeeAvatars(
      eventId,
      likedMatched.map((i) => i.interestId),
    );

    return { score, reasons, similarAttendees };
  }

  async getCrowdPulse(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, crowdPulse: true },
    });
    if (!event) throw new NotFoundException('Event not found');

    let pulse = event.crowdPulse as unknown as CrowdPulseCache | null;
    if (!pulse) {
      pulse = await this.computeAndStoreCrowdPulse(eventId);
    }

    const avatars = await this.getTopAttendeeAvatars(eventId);

    return {
      totalAttendees: pulse.totalAttendees,
      energy: pulse.energy,
      crowdStyle: pulse.crowdStyle,
      socialFriendliness: pulse.socialFriendliness,
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

    if (total === 0) {
      const pulse: CrowdPulseCache = {
        energy: 'MEDIUM',
        dominantVibeType: null,
        crowdStyle: 'Mixed Crowd',
        socialFriendliness: 'Friendly',
        totalAttendees: 0,
        computedAt: new Date().toISOString(),
      };
      await this.prisma.event.update({ where: { id: eventId }, data: { crowdPulse: pulse as object } });
      return pulse;
    }

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

    const withVibe = profiles.filter((p) => p.vibeType).length || 1;
    const lifeOfPartyPct = vibeCounts.LIFE_OF_PARTY / withVibe;
    const chillPct = vibeCounts.CHILL_OBSERVING / withVibe;

    const energy: CrowdPulseCache['energy'] =
      lifeOfPartyPct > 0.4 ? 'HIGH' : chillPct > 0.4 ? 'LOW' : 'MEDIUM';

    const dominantVibeType = (Object.entries(vibeCounts) as [VibeType, number][]).reduce((a, b) =>
      b[1] > a[1] ? b : a,
    )[0];

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

    const socialFriendliness =
      openToMeetingPct > 0.5 ? 'Very Friendly' : bringingGangPct > 0.4 ? 'Group-Friendly' : 'Friendly';

    // Crowd style
    const partyLean = vibeCounts.LIFE_OF_PARTY + socialCounts.BRINGING_GANG;
    const socialLean = vibeCounts.HERE_TO_CONNECT + socialCounts.OPEN_TO_MEETING;
    const chillLean = vibeCounts.CHILL_OBSERVING + socialCounts.SOLO_EXPLORER;
    const maxLean = Math.max(partyLean, socialLean, chillLean);
    const crowdStyle =
      maxLean === partyLean ? 'Party Energy' : maxLean === socialLean ? 'Trendy & Social' : 'Laid-back & Chill';

    const pulse: CrowdPulseCache = {
      energy,
      dominantVibeType,
      crowdStyle,
      socialFriendliness,
      totalAttendees: total,
      computedAt: new Date().toISOString(),
    };

    await this.prisma.event.update({ where: { id: eventId }, data: { crowdPulse: pulse as object } });
    return pulse;
  }

  // ─── Score helpers ───────────────────────────────────────────────────────────

  private computeInterestScore(interests: InterestAffinityInputDto[], categorySet: Set<string>): number {
    let pts = 0;
    for (const i of interests) {
      if (!categorySet.has(i.interestId)) continue;
      if (i.affinity === 'LIKED') pts += 10;
      else if (i.affinity === 'OPEN_TO') pts += 5;
      else if (i.affinity === 'DISLIKED') pts -= 5;
    }
    return Math.max(0, Math.min(40, pts));
  }

  private computeVibeScore(vibeType: VibeType | null, dominantCrowd: VibeType | null): number {
    if (!vibeType) return 15;
    if (!dominantCrowd) return 20;
    if (vibeType === dominantCrowd) return 30;
    if (vibeType === 'OPEN_TO_WHATEVER') return 25;
    const compatible: Partial<Record<VibeType, VibeType[]>> = {
      LIFE_OF_PARTY: ['HERE_TO_CONNECT'],
      HERE_TO_CONNECT: ['LIFE_OF_PARTY', 'OPEN_TO_WHATEVER'],
      CHILL_OBSERVING: ['OPEN_TO_WHATEVER'],
    };
    if (compatible[vibeType]?.includes(dominantCrowd)) return 20;
    return 10;
  }

  private computeSocialScore(socialStyle: SocialStyle | null): number {
    if (!socialStyle) return 15;
    if (socialStyle === 'OPEN_TO_MEETING') return 30;
    if (socialStyle === 'BRINGING_GANG') return 20;
    return 15;
  }

  // ─── Reasons ────────────────────────────────────────────────────────────────

  private buildReasons(
    dto: VibeMatchDto,
    matchedInterestNames: string[],
    hasDislikedMatch: boolean,
    similarCount: number,
    crowdPulse: CrowdPulseCache | null,
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

    return [
      { type: 'SHARED_INTERESTS', label: 'Shared Interests', description: sharedDesc },
      { type: 'ROOM_FIT', label: 'Room fit', description: roomDesc },
      { type: 'ENERGY_ALIGNMENT', label: 'Energy alignment', description: energyDesc },
    ];
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
