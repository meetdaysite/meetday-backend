import { Injectable, NotFoundException } from '@nestjs/common';
import { CommunityMemberStatus, CommunityRole, CommunityStatus, EventStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { StorageService } from '../../common/storage/storage.service';

const DAY = 24 * 60 * 60 * 1000;
const SPARK_DAYS = 14;
const CACHE_TTL = 60;
const MANAGER_ROLES: CommunityRole[] = [
  CommunityRole.OWNER,
  CommunityRole.MANAGER,
  CommunityRole.MODERATOR,
  CommunityRole.HOST,
];

interface DailyRow {
  day: Date;
  count: number;
}

@Injectable()
export class CommunityOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
  ) {}

  async getOverview(communityId: string) {
    const cacheKey = `overview:${communityId}`;
    const cached = await this.redis.get<unknown>(cacheKey);
    if (cached) return cached;

    const community = await this.prisma.community.findFirst({
      where: { id: communityId, deletedAt: null },
      select: {
        id: true, name: true, slug: true, type: true, status: true, access: true,
        description: true, iconKey: true, coverImageKey: true, memberCount: true, createdAt: true,
      },
    });
    if (!community) throw new NotFoundException('Community not found');

    const now = Date.now();
    const since14 = new Date(now - SPARK_DAYS * DAY);

    const [
      memberSeries, eventAddSeries, reachSeries, messageSeries,
      activeExperiencesValue, upcomingExperiences, managers, recentActivity, topEngagement7d,
      iconUrl, coverUrl,
    ] = await Promise.all([
      this.dailySeries('community_members', 'joinedAt', communityId, since14),
      this.dailySeries('community_events', 'addedAt', communityId, since14),
      this.dailySeries('community_post_views', 'viewedAt', communityId, since14),
      this.dailySeries('channel_messages', 'createdAt', communityId, since14, 'AND "deletedAt" IS NULL'),
      this.countActiveExperiences(communityId),
      this.getUpcomingExperiences(communityId),
      this.getManagers(communityId),
      this.getRecentActivity(communityId),
      this.getTopEngagement(communityId, new Date(now - 7 * DAY)),
      community.iconKey ? this.storage.getPresignedDownloadUrl(community.iconKey) : Promise.resolve(null),
      community.coverImageKey ? this.storage.getPresignedDownloadUrl(community.coverImageKey) : Promise.resolve(null),
    ]);

    const payload = {
      community: {
        id: community.id, name: community.name, slug: community.slug, type: community.type,
        status: community.status, access: community.access, description: community.description,
        iconUrl, coverUrl, createdAt: community.createdAt,
        url: `meetday.ai/communities/${community.slug}`,
      },
      stats: {
        totalMembers: this.statFromSeries(memberSeries, community.memberCount),
        activeExperiences: { ...this.statFromSeries(eventAddSeries), value: activeExperiencesValue },
        postReach7d: this.statFromSeries(reachSeries),
        messages7d: this.statFromSeries(messageSeries),
      },
      upcomingExperiences,
      managers,
      recentActivity,
      topEngagement7d,
    };

    await this.redis.set(cacheKey, payload, CACHE_TTL);
    return payload;
  }

  async getManagers(communityId: string) {
    const rows = await this.prisma.communityMember.findMany({
      where: { communityId, status: CommunityMemberStatus.ACTIVE, role: { in: MANAGER_ROLES } },
      orderBy: { role: 'asc' },
      select: {
        role: true,
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      },
    });
    return Promise.all(
      rows.map(async (m) => ({
        userId: m.user.id,
        firstName: m.user.firstName,
        lastName: m.user.lastName,
        avatarUrl: m.user.avatarUrl ? await this.storage.getPresignedDownloadUrl(m.user.avatarUrl) : null,
        role: m.role,
      })),
    );
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** Returns a 14-point daily count series (oldest→newest), value, 7d delta + deltaPct. */
  private statFromSeries(series: number[], explicitValue?: number) {
    const last7 = series.slice(SPARK_DAYS - 7).reduce((a, b) => a + b, 0);
    const prev7 = series.slice(0, SPARK_DAYS - 7).reduce((a, b) => a + b, 0);
    const deltaPct = Math.round(((last7 - prev7) / Math.max(prev7, 1)) * 100);
    return { value: explicitValue ?? last7, delta7d: last7, deltaPct, sparkline: series };
  }

  /** One grouped raw query → fixed 14-length daily array (zero-filled, oldest→newest). */
  private async dailySeries(
    table: string,
    tsColumn: string,
    communityId: string,
    since: Date,
    extraWhere = '',
  ): Promise<number[]> {
    const rows = await this.prisma.$queryRawUnsafe<DailyRow[]>(
      `SELECT date_trunc('day', "${tsColumn}") AS day, count(*)::int AS count
       FROM "${table}"
       WHERE "communityId" = $1 AND "${tsColumn}" >= $2 ${extraWhere}
       GROUP BY 1 ORDER BY 1`,
      communityId,
      since,
    );

    const buckets = new Array(SPARK_DAYS).fill(0);
    const startDay = new Date(since); startDay.setHours(0, 0, 0, 0);
    for (const r of rows) {
      const idx = Math.floor((new Date(r.day).getTime() - startDay.getTime()) / DAY);
      if (idx >= 0 && idx < SPARK_DAYS) buckets[idx] = Number(r.count);
    }
    return buckets;
  }

  private async countActiveExperiences(communityId: string): Promise<number> {
    return this.prisma.communityEvent.count({
      where: { communityId, event: { status: EventStatus.PUBLISHED, eventDate: { gte: new Date() } } },
    });
  }

  private async getUpcomingExperiences(communityId: string) {
    const links = await this.prisma.communityEvent.findMany({
      where: { communityId, event: { status: EventStatus.PUBLISHED, eventDate: { gte: new Date() } } },
      orderBy: { event: { eventDate: 'asc' } },
      take: 6,
      select: {
        event: {
          select: {
            id: true, title: true, eventDate: true, city: true,
            tickets: { select: { soldCount: true } },
            media: { where: { type: 'COVER' }, orderBy: { order: 'asc' }, take: 1, select: { url: true } },
          },
        },
      },
    });

    const eventIds = links.map((l) => l.event.id);
    const ratings = eventIds.length
      ? await this.prisma.eventReview.groupBy({
          by: ['eventId'],
          where: { eventId: { in: eventIds }, isVisible: true },
          _avg: { rating: true },
        })
      : [];
    const ratingMap = new Map(ratings.map((r) => [r.eventId, r._avg.rating]));

    return Promise.all(
      links.map(async (l) => {
        const e = l.event;
        return {
          id: e.id,
          title: e.title,
          eventDate: e.eventDate,
          city: e.city,
          coverUrl: e.media[0]?.url ? await this.storage.getPresignedDownloadUrl(e.media[0].url) : null,
          attendeeCount: e.tickets.reduce((s, t) => s + t.soldCount, 0),
          avgRating: ratingMap.get(e.id) ? Math.round((ratingMap.get(e.id) as number) * 10) / 10 : null,
        };
      }),
    );
  }

  private async getRecentActivity(communityId: string) {
    const [members, events, posts, announcements] = await Promise.all([
      this.prisma.communityMember.findMany({
        where: { communityId, status: CommunityMemberStatus.ACTIVE, joinedAt: { not: null } },
        orderBy: { joinedAt: 'desc' }, take: 8,
        select: { joinedAt: true, user: { select: { firstName: true, lastName: true } } },
      }),
      this.prisma.communityEvent.findMany({
        where: { communityId, source: 'AUTO' },
        orderBy: { addedAt: 'desc' }, take: 8,
        select: { addedAt: true, event: { select: { title: true } } },
      }),
      this.prisma.communityPost.findMany({
        where: { communityId, deletedAt: null },
        orderBy: { createdAt: 'desc' }, take: 8,
        select: { createdAt: true, author: { select: { firstName: true, lastName: true } } },
      }),
      this.prisma.communityAnnouncement.findMany({
        where: { communityId, deletedAt: null },
        orderBy: { publishedAt: 'desc' }, take: 8,
        select: { publishedAt: true, title: true },
      }),
    ]);

    const items = [
      ...members.map((m) => ({
        type: 'MEMBER_JOINED' as const,
        title: `${m.user.firstName} ${m.user.lastName} joined the community`,
        actor: `${m.user.firstName} ${m.user.lastName}`,
        at: m.joinedAt as Date,
      })),
      ...events.map((e) => ({
        type: 'EXPERIENCE_MATCHED' as const,
        title: `${e.event.title ?? 'An experience'} was added automatically`,
        actor: null,
        at: e.addedAt,
      })),
      ...posts.map((p) => ({
        type: 'NEW_POST' as const,
        title: `${p.author.firstName} ${p.author.lastName} posted in the community feed`,
        actor: `${p.author.firstName} ${p.author.lastName}`,
        at: p.createdAt,
      })),
      ...announcements.map((a) => ({
        type: 'ANNOUNCEMENT_CREATED' as const,
        title: `Announcement: "${a.title}"`,
        actor: null,
        at: a.publishedAt,
      })),
    ];

    return items.sort((x, y) => y.at.getTime() - x.at.getTime()).slice(0, 8);
  }

  private async getTopEngagement(communityId: string, since: Date) {
    const [posts, comments, reactions, shares, newMembers] = await Promise.all([
      this.prisma.communityPost.count({ where: { communityId, deletedAt: null, createdAt: { gte: since } } }),
      this.prisma.communityPostComment.count({ where: { post: { communityId }, deletedAt: null, createdAt: { gte: since } } }),
      this.prisma.communityPostReaction.count({ where: { post: { communityId }, createdAt: { gte: since } } }),
      this.prisma.communityPostShare.count({ where: { post: { communityId }, createdAt: { gte: since } } }),
      this.prisma.communityMember.count({ where: { communityId, joinedAt: { gte: since } } }),
    ]);
    return { posts, comments, reactions, shares, newMembers };
  }
}
