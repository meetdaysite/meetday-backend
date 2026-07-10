import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CommunityMemberStatus,
  CommunityRole,
  CommunityStatus,
  MemberProfileVisibility,
  MemberVisibility,
  Prisma,
} from '@prisma/client';
import { StorageService } from '../../common/storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CommunityPresenceService } from '../community-chat/community-presence.service';
import { CommunityDmService } from '../community-chat/community-dm.service';
import { ListMembersQueryDto, MemberFilter, MemberSort } from './dto/list-members-query.dto';

// Activity-score weights (tunable) and badge thresholds.
const MSG_WEIGHT = 1;
const EVENT_WEIGHT = 5;
const NEW_MEMBER_DAYS = 14;
const TOP_CONTRIBUTOR_SCORE = 50;
const ACTIVE_MEMBER_SCORE = 5;
const MAX_INTEREST_TAGS = 5;
const FEATURED_COUNT = 5;

export function computeActivityScore(messageCount: number, eventsAttendedCount: number): number {
  return messageCount * MSG_WEIGHT + eventsAttendedCount * EVENT_WEIGHT;
}

type MemberBadge = 'NEW_MEMBER' | 'TOP_CONTRIBUTOR' | 'ACTIVE_MEMBER' | null;

const MEMBER_SELECT = {
  role: true,
  joinedAt: true,
  profileVisibility: true,
  messageCount: true,
  eventsAttendedCount: true,
  activityScore: true,
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      avatarUrl: true,
      attendeeProfile: { select: { city: true, bio: true, vibeType: true, socialStyle: true } },
    },
  },
} satisfies Prisma.CommunityMemberSelect;

type MemberRow = Prisma.CommunityMemberGetPayload<{ select: typeof MEMBER_SELECT }>;

@Injectable()
export class CommunityMembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly presence: CommunityPresenceService,
    private readonly dmService: CommunityDmService,
  ) {}

  // ─── List ───────────────────────────────────────────────────────────────────

  async list(communityId: string, viewerId: string, query: ListMembersQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const filter = query.filter ?? MemberFilter.ALL;
    const sort = query.sort ?? MemberSort.RECENTLY_ACTIVE;

    const community = await this.loadCommunity(communityId);
    await this.assertDirectoryAccess(community, viewerId);

    const onlineIds = await this.presence.getOnlineUserIds(communityId);
    const onlineSet = new Set(onlineIds);

    const where = this.buildWhere(communityId, filter, query.search, onlineIds);

    // Online filter with nobody online → short-circuit.
    if (filter === MemberFilter.ONLINE && onlineIds.length === 0) {
      return { data: [], featured: [], total: 0, page, limit };
    }

    const [rows, total] = await Promise.all([
      this.prisma.communityMember.findMany({
        where,
        select: MEMBER_SELECT,
        orderBy: this.buildOrderBy(sort),
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.communityMember.count({ where }),
    ]);

    const data = await this.toCards(rows, viewerId, onlineSet);

    const featured =
      page === 1
        ? await this.toCards(
            await this.prisma.communityMember.findMany({
              where: { communityId, status: CommunityMemberStatus.ACTIVE },
              select: MEMBER_SELECT,
              orderBy: { activityScore: 'desc' },
              take: FEATURED_COUNT,
            }),
            viewerId,
            onlineSet,
          )
        : [];

    return { data, featured, total, page, limit };
  }

  // ─── Detail ───────────────────────────────────────────────────────────────

  async detail(communityId: string, viewerId: string, targetUserId: string) {
    const community = await this.loadCommunity(communityId);
    await this.assertDirectoryAccess(community, viewerId);

    const member = await this.prisma.communityMember.findFirst({
      where: { communityId, userId: targetUserId, status: CommunityMemberStatus.ACTIVE },
      select: MEMBER_SELECT,
    });
    if (!member) throw new NotFoundException('Member not found');

    const isSelf = viewerId === targetUserId;
    const avatarUrl = await this.signAvatar(member.user.avatarUrl);
    const isOnline = (await this.presence.getOnlineUserIds(communityId)).includes(targetUserId);

    // Shared experiences also decide EVENT_ATTENDEES_ONLY visibility.
    const [viewerEventIds, targetEventIds] = await Promise.all([
      this.attendedCommunityEventIds(communityId, viewerId),
      this.attendedCommunityEventIds(communityId, targetUserId),
    ]);
    const sharedEventIds = targetEventIds.filter((id) => viewerEventIds.includes(id));

    const level = this.visibilityLevel(member.profileVisibility, isSelf, sharedEventIds.length > 0);

    const dmStatus = isSelf
      ? 'none'
      : await this.dmService.getDmStatusFor(communityId, viewerId, targetUserId);

    const base = {
      userId: member.user.id,
      firstName: member.user.firstName,
      lastName: member.user.lastName,
      avatarUrl,
      role: member.role,
      badge: this.computeBadge(member),
      isOnline,
      joinedAt: member.joinedAt,
      dmStatus, // none | intro_sent | intro_received | connected — drives the CTA
    };

    if (level === 'basic') {
      return {
        ...base,
        city: member.profileVisibility === MemberProfileVisibility.PRIVATE ? null : member.user.attendeeProfile?.city ?? null,
        restricted: true,
      };
    }

    const [interests, sharedInterests, sharedExperiences, communityPosts] = await Promise.all([
      this.interestsFor(targetUserId),
      this.sharedInterests(viewerId, targetUserId),
      this.experiencesByIds(sharedEventIds),
      this.prisma.communityAnnouncement.count({
        where: { communityId, authorId: targetUserId, deletedAt: null },
      }),
    ]);

    return {
      ...base,
      restricted: false,
      city: member.user.attendeeProfile?.city ?? null,
      bio: member.user.attendeeProfile?.bio ?? null,
      vibeType: member.user.attendeeProfile?.vibeType ?? null,
      socialStyle: member.user.attendeeProfile?.socialStyle ?? null,
      interests,
      sharedInterests,
      sharedExperiences,
      communityActivity: {
        experiencesAttended: member.eventsAttendedCount,
        communityPosts,
        chatReplies: member.messageCount,
      },
    };
  }

  // ─── Recompute (called from orders on confirm/cancel) ───────────────────────

  /** Recompute a member's eventsAttendedCount + activityScore for one community. */
  async recomputeEventCount(communityId: string, userId: string): Promise<void> {
    const member = await this.prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId, userId } },
      select: { messageCount: true },
    });
    if (!member) return; // not a member of this community

    const eventIds = await this.attendedCommunityEventIds(communityId, userId);
    const eventsAttendedCount = eventIds.length;

    await this.prisma.communityMember.update({
      where: { communityId_userId: { communityId, userId } },
      data: {
        eventsAttendedCount,
        activityScore: computeActivityScore(member.messageCount, eventsAttendedCount),
      },
    });
  }

  /** Recompute across every community the event belongs to (for the buyer/attendee). */
  async recomputeForEvent(eventId: string, userId: string): Promise<void> {
    const links = await this.prisma.communityEvent.findMany({
      where: { eventId },
      select: { communityId: true },
    });
    await Promise.all(links.map((l) => this.recomputeEventCount(l.communityId, userId)));
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private async loadCommunity(communityId: string) {
    const community = await this.prisma.community.findFirst({
      where: { id: communityId, status: CommunityStatus.PUBLISHED, deletedAt: null },
      select: { id: true, memberVisibility: true },
    });
    if (!community) throw new NotFoundException('Community not found');
    return community;
  }

  private async assertDirectoryAccess(
    community: { id: string; memberVisibility: MemberVisibility },
    viewerId: string,
  ): Promise<void> {
    if (community.memberVisibility === MemberVisibility.HIDDEN) {
      throw new ForbiddenException('The member directory is hidden for this community');
    }
    if (community.memberVisibility === MemberVisibility.AFTER_ATTENDING) {
      const attended = await this.attendedCommunityEventIds(community.id, viewerId);
      if (attended.length === 0) {
        throw new ForbiddenException('Attend an event to view the member directory');
      }
    }
  }

  private buildWhere(
    communityId: string,
    filter: MemberFilter,
    search: string | undefined,
    onlineIds: string[],
  ): Prisma.CommunityMemberWhereInput {
    const where: Prisma.CommunityMemberWhereInput = {
      communityId,
      status: CommunityMemberStatus.ACTIVE,
    };

    switch (filter) {
      case MemberFilter.ONLINE:
        where.userId = { in: onlineIds };
        break;
      case MemberFilter.NEW:
        where.joinedAt = { gte: new Date(Date.now() - NEW_MEMBER_DAYS * 24 * 60 * 60 * 1000) };
        break;
      case MemberFilter.ACTIVE:
        where.activityScore = { gt: 0 };
        break;
      case MemberFilter.ATTENDED:
        where.eventsAttendedCount = { gt: 0 };
        break;
      case MemberFilter.HOSTS:
        where.role = CommunityRole.HOST;
        break;
    }

    if (search) {
      where.user = {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { attendeeProfile: { city: { contains: search, mode: 'insensitive' } } },
        ],
      };
    }

    return where;
  }

  private buildOrderBy(sort: MemberSort): Prisma.CommunityMemberOrderByWithRelationInput {
    switch (sort) {
      case MemberSort.NEWEST:
        return { joinedAt: { sort: 'desc', nulls: 'last' } };
      case MemberSort.MOST_ACTIVE:
        return { activityScore: 'desc' };
      case MemberSort.ALPHABETICAL:
        return { user: { firstName: 'asc' } };
      case MemberSort.RECENTLY_ACTIVE:
      default:
        return { lastActivityAt: { sort: 'desc', nulls: 'last' } };
    }
  }

  private computeBadge(member: { joinedAt: Date | null; activityScore: number }): MemberBadge {
    if (member.joinedAt && member.joinedAt >= new Date(Date.now() - NEW_MEMBER_DAYS * 24 * 60 * 60 * 1000)) {
      return 'NEW_MEMBER';
    }
    if (member.activityScore >= TOP_CONTRIBUTOR_SCORE) return 'TOP_CONTRIBUTOR';
    if (member.activityScore >= ACTIVE_MEMBER_SCORE) return 'ACTIVE_MEMBER';
    return null;
  }

  private async toCards(rows: MemberRow[], viewerId: string, onlineSet: Set<string>) {
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.user.id);
    const interestMap = await this.interestsForMany(ids);
    const avatarMap = await this.signAvatarsMany(rows);

    return rows.map((m) => {
      const isSelf = m.user.id === viewerId;
      const isPrivate = m.profileVisibility === MemberProfileVisibility.PRIVATE && !isSelf;

      return {
        userId: m.user.id,
        firstName: m.user.firstName,
        lastName: m.user.lastName,
        avatarUrl: avatarMap.get(m.user.id) ?? null,
        role: m.role,
        badge: this.computeBadge(m),
        isOnline: isSelf || onlineSet.has(m.user.id),
        isMe: isSelf,
        joinedAt: m.joinedAt,
        // Redacted for PRIVATE members (unless viewing self)
        city: isPrivate ? null : m.user.attendeeProfile?.city ?? null,
        interestTags: isPrivate ? [] : interestMap.get(m.user.id) ?? [],
        eventsAttendedCount: isPrivate ? null : m.eventsAttendedCount,
      };
    });
  }

  private visibilityLevel(
    visibility: MemberProfileVisibility,
    isSelf: boolean,
    sharesEvent: boolean,
  ): 'full' | 'basic' {
    if (isSelf || visibility === MemberProfileVisibility.COMMUNITY_MEMBERS) return 'full';
    if (visibility === MemberProfileVisibility.EVENT_ATTENDEES_ONLY) {
      return sharesEvent ? 'full' : 'basic';
    }
    return 'basic'; // PRIVATE
  }

  /** Distinct community event ids the user has a CONFIRMED order for (counts guests via OrderAttendee). */
  private async attendedCommunityEventIds(communityId: string, userId: string): Promise<string[]> {
    const rows = await this.prisma.orderAttendee.findMany({
      where: {
        userId,
        orderItem: {
          order: {
            status: 'CONFIRMED',
            event: { communities: { some: { communityId } } },
          },
        },
      },
      select: { orderItem: { select: { order: { select: { eventId: true } } } } },
    });
    return [...new Set(rows.map((r) => r.orderItem.order.eventId))];
  }

  private async interestsForMany(userIds: string[]): Promise<Map<string, { id: string; name: string }[]>> {
    const rows = await this.prisma.userInterestAffinity.findMany({
      where: { userId: { in: userIds }, affinity: { not: 'DISLIKED' } },
      select: { userId: true, interest: { select: { id: true, name: true } } },
      orderBy: { interest: { name: 'asc' } },
    });

    const map = new Map<string, { id: string; name: string }[]>();
    for (const r of rows) {
      const list = map.get(r.userId) ?? [];
      if (list.length < MAX_INTEREST_TAGS) list.push(r.interest);
      map.set(r.userId, list);
    }
    return map;
  }

  private async interestsFor(userId: string): Promise<{ id: string; name: string }[]> {
    return (await this.interestsForMany([userId])).get(userId) ?? [];
  }

  private async sharedInterests(viewerId: string, targetId: string): Promise<{ id: string; name: string }[]> {
    const rows = await this.prisma.userInterestAffinity.findMany({
      where: { userId: { in: [viewerId, targetId] }, affinity: { not: 'DISLIKED' } },
      select: { userId: true, interest: { select: { id: true, name: true } } },
    });
    const viewerIds = new Set(rows.filter((r) => r.userId === viewerId).map((r) => r.interest.id));
    const seen = new Set<string>();
    const shared: { id: string; name: string }[] = [];
    for (const r of rows) {
      if (r.userId === targetId && viewerIds.has(r.interest.id) && !seen.has(r.interest.id)) {
        seen.add(r.interest.id);
        shared.push(r.interest);
      }
    }
    return shared;
  }

  private async experiencesByIds(eventIds: string[]) {
    if (eventIds.length === 0) return [];
    const events = await this.prisma.event.findMany({
      where: { id: { in: eventIds } },
      select: {
        id: true,
        title: true,
        eventDate: true,
        city: true,
        media: { where: { type: 'COVER' }, orderBy: { order: 'asc' }, take: 1, select: { url: true } },
      },
      orderBy: { eventDate: 'desc' },
    });

    return Promise.all(
      events.map(async (e) => ({
        id: e.id,
        title: e.title,
        eventDate: e.eventDate,
        city: e.city,
        coverUrl: e.media[0]?.url ? await this.storage.getPresignedDownloadUrl(e.media[0].url) : null,
      })),
    );
  }

  private async signAvatar(key: string | null): Promise<string | null> {
    return key ? this.storage.getPresignedDownloadUrl(key) : null;
  }

  private async signAvatarsMany(rows: MemberRow[]): Promise<Map<string, string | null>> {
    const map = new Map<string, string | null>();
    await Promise.all(
      rows.map(async (r) => {
        map.set(r.user.id, await this.signAvatar(r.user.avatarUrl));
      }),
    );
    return map;
  }
}
