import { Injectable, NotFoundException } from '@nestjs/common';
import { AgeRange, AnnouncementStatus, CommunityMemberStatus, CommunityRole, OrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { StorageService } from '../../common/storage/storage.service';

const DAY = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;
const CACHE_TTL = 5 * 60;

interface DailyRow {
  day: Date;
  count: number | bigint;
}

interface InterestRow {
  name: string;
  cnt: number | bigint;
}

interface CityRow {
  city: string;
  count: number | bigint;
}

interface AgeRow {
  ageRange: AgeRange;
  count: number | bigint;
}

interface TopExpRow {
  id: string;
  title: string | null;
  bookings: number | bigint;
  revenue: number;
  attendancePct: number | null;
}

const AGE_RANGE_LABELS: Record<AgeRange, string> = {
  UNDER_18: 'Under 18',
  AGE_18_24: '18–24',
  AGE_25_34: '25–34',
  AGE_35_44: '35–44',
  AGE_45_54: '45–54',
  AGE_55_PLUS: '55+',
};

function deltaPct(current: number, prior: number): number {
  return Math.round(((current - prior) / Math.max(prior, 1)) * 100);
}

@Injectable()
export class CommunityAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
  ) {}

  async getAnalytics(communityId: string) {
    const cacheKey = `analytics:${communityId}`;
    const cached = await this.redis.get<unknown>(cacheKey);
    if (cached) return cached;

    const community = await this.prisma.community.findFirst({
      where: { id: communityId, deletedAt: null },
      select: { memberCount: true },
    });
    if (!community) throw new NotFoundException('Community not found');

    const now = new Date();
    const window30Start = new Date(now.getTime() - WINDOW_DAYS * DAY);
    const window60Start = new Date(now.getTime() - 2 * WINDOW_DAYS * DAY);

    const [
      summary,
      growth,
      engagement,
      experiencesImpact,
      memberInsights,
      topContributors,
      topHosts,
      deletedRateData,
    ] = await Promise.all([
      this.getSummary(communityId, community.memberCount, window30Start, window60Start),
      this.getGrowth(communityId, window30Start, window60Start),
      this.getEngagement(communityId, window30Start, window60Start),
      this.getExperiencesImpact(communityId, window30Start, window60Start),
      this.getMemberInsights(communityId),
      this.getTopContributors(communityId),
      this.getTopHosts(communityId),
      this.getDeletedRateData(communityId),
    ]);

    const healthScore = this.computeHealthScore({
      activeMembers: summary.activeMembers.value,
      retentionPct: summary.retention.value,
      totalEngagement:
        engagement.posts.value +
        engagement.comments.value +
        engagement.reactions.value +
        engagement.shares.value +
        engagement.chatMessages.value,
      growthRatePct: growth.growthRatePct,
      attendances: experiencesImpact.topExperiences
        .map((e) => e.attendancePct)
        .filter((p): p is number => p !== null),
      deletedRate: deletedRateData.deletedRate,
    });

    const payload = {
      summary,
      growth,
      engagement,
      experiencesImpact,
      healthScore,
      memberInsights,
      topContributors,
      topHosts,
    };

    await this.redis.set(cacheKey, payload, CACHE_TTL);
    return payload;
  }

  // ── Summary ────────────────────────────────────────────────────────────────

  private async getSummary(
    communityId: string,
    memberCount: number,
    window30Start: Date,
    window60Start: Date,
  ) {
    const communityEventFilter = { event: { communities: { some: { communityId } } } };

    const [
      joinedCurrent,
      joinedPrior,
      activeCurrent,
      activePrior,
      bookingsCurrent,
      bookingsPrior,
      revenueCurrent,
      revenuePrior,
      activeCount,
      totalCount,
    ] = await Promise.all([
      this.prisma.communityMember.count({ where: { communityId, joinedAt: { gte: window30Start } } }),
      this.prisma.communityMember.count({ where: { communityId, joinedAt: { gte: window60Start, lt: window30Start } } }),
      this.prisma.communityMember.count({ where: { communityId, lastActivityAt: { gte: window30Start } } }),
      this.prisma.communityMember.count({ where: { communityId, lastActivityAt: { gte: window60Start, lt: window30Start } } }),
      this.prisma.order.count({
        where: {
          status: OrderStatus.CONFIRMED,
          confirmedAt: { gte: window30Start },
          ...communityEventFilter,
        },
      }),
      this.prisma.order.count({
        where: {
          status: OrderStatus.CONFIRMED,
          confirmedAt: { gte: window60Start, lt: window30Start },
          ...communityEventFilter,
        },
      }),
      this.prisma.order.aggregate({
        where: {
          status: OrderStatus.CONFIRMED,
          confirmedAt: { gte: window30Start },
          ...communityEventFilter,
        },
        _sum: { totalAmount: true },
      }),
      this.prisma.order.aggregate({
        where: {
          status: OrderStatus.CONFIRMED,
          confirmedAt: { gte: window60Start, lt: window30Start },
          ...communityEventFilter,
        },
        _sum: { totalAmount: true },
      }),
      this.prisma.communityMember.count({ where: { communityId, status: CommunityMemberStatus.ACTIVE } }),
      this.prisma.communityMember.count({ where: { communityId } }),
    ]);

    const retention = totalCount > 0 ? Math.round((activeCount / totalCount) * 100) : 100;
    const revCurrent = Number(revenueCurrent._sum.totalAmount ?? 0);
    const revPrior = Number(revenuePrior._sum.totalAmount ?? 0);

    return {
      members: { value: memberCount, deltaPct: deltaPct(joinedCurrent, joinedPrior) },
      activeMembers: { value: activeCurrent, deltaPct: deltaPct(activeCurrent, activePrior) },
      experiencesBooked: { value: bookingsCurrent, deltaPct: deltaPct(bookingsCurrent, bookingsPrior) },
      communityRevenue: { value: revCurrent, deltaPct: deltaPct(revCurrent, revPrior) },
      retention: { value: retention, deltaPct: 0 },
    };
  }

  // ── Growth ─────────────────────────────────────────────────────────────────

  private async getGrowth(communityId: string, window30Start: Date, window60Start: Date) {
    const [joinedRows, leftRows, joinedPrior, joinedCurrent] = await Promise.all([
      this.prisma.$queryRawUnsafe<DailyRow[]>(
        `SELECT date_trunc('day', "joinedAt") AS day, count(*)::int AS count
         FROM "community_members"
         WHERE "communityId" = $1 AND "joinedAt" >= $2
         GROUP BY 1 ORDER BY 1`,
        communityId,
        window30Start,
      ),
      this.prisma.$queryRawUnsafe<DailyRow[]>(
        `SELECT date_trunc('day', "updatedAt") AS day, count(*)::int AS count
         FROM "community_members"
         WHERE "communityId" = $1 AND status = 'LEFT' AND "updatedAt" >= $2
         GROUP BY 1 ORDER BY 1`,
        communityId,
        window30Start,
      ),
      this.prisma.communityMember.count({
        where: { communityId, joinedAt: { gte: window60Start, lt: window30Start } },
      }),
      this.prisma.communityMember.count({ where: { communityId, joinedAt: { gte: window30Start } } }),
    ]);

    const joinedBuckets = this.toDaily(joinedRows, window30Start);
    const leftBuckets = this.toDaily(leftRows, window30Start);

    const startDay = new Date(window30Start);
    startDay.setHours(0, 0, 0, 0);
    const series = joinedBuckets.map((joined, i) => ({
      date: new Date(startDay.getTime() + i * DAY).toISOString().slice(0, 10),
      joined,
      left: leftBuckets[i],
      netGrowth: joined - leftBuckets[i],
    }));

    const totalJoined = joinedBuckets.reduce((a, b) => a + b, 0);
    const totalLeft = leftBuckets.reduce((a, b) => a + b, 0);

    return {
      series,
      totalJoined,
      totalLeft,
      netGrowth: totalJoined - totalLeft,
      growthRatePct: deltaPct(joinedCurrent, joinedPrior),
    };
  }

  // ── Engagement ─────────────────────────────────────────────────────────────

  private async getEngagement(communityId: string, window30Start: Date, window60Start: Date) {
    const [
      postsCurrent,
      postsPrior,
      commentsCurrent,
      commentsPrior,
      reactionsCurrent,
      reactionsPrior,
      sharesCurrent,
      sharesPrior,
      chatCurrent,
      chatPrior,
      reachCurrent,
      reachPrior,
    ] = await Promise.all([
      this.prisma.communityPost.count({ where: { communityId, deletedAt: null, createdAt: { gte: window30Start } } }),
      this.prisma.communityPost.count({ where: { communityId, deletedAt: null, createdAt: { gte: window60Start, lt: window30Start } } }),
      this.prisma.communityPostComment.count({ where: { post: { communityId }, deletedAt: null, createdAt: { gte: window30Start } } }),
      this.prisma.communityPostComment.count({ where: { post: { communityId }, deletedAt: null, createdAt: { gte: window60Start, lt: window30Start } } }),
      this.prisma.communityPostReaction.count({ where: { post: { communityId }, createdAt: { gte: window30Start } } }),
      this.prisma.communityPostReaction.count({ where: { post: { communityId }, createdAt: { gte: window60Start, lt: window30Start } } }),
      this.prisma.communityPostShare.count({ where: { post: { communityId }, createdAt: { gte: window30Start } } }),
      this.prisma.communityPostShare.count({ where: { post: { communityId }, createdAt: { gte: window60Start, lt: window30Start } } }),
      this.prisma.channelMessage.count({ where: { communityId, deletedAt: null, createdAt: { gte: window30Start } } }),
      this.prisma.channelMessage.count({ where: { communityId, deletedAt: null, createdAt: { gte: window60Start, lt: window30Start } } }),
      this.prisma.communityAnnouncement.aggregate({
        where: { communityId, status: AnnouncementStatus.PUBLISHED, publishedAt: { gte: window30Start } },
        _sum: { reachCount: true },
      }),
      this.prisma.communityAnnouncement.aggregate({
        where: {
          communityId,
          status: AnnouncementStatus.PUBLISHED,
          publishedAt: { gte: window60Start, lt: window30Start },
        },
        _sum: { reachCount: true },
      }),
    ]);

    const reachVal = Number(reachCurrent._sum.reachCount ?? 0);
    const reachPriorVal = Number(reachPrior._sum.reachCount ?? 0);

    return {
      posts: { value: postsCurrent, changePct: deltaPct(postsCurrent, postsPrior) },
      comments: { value: commentsCurrent, changePct: deltaPct(commentsCurrent, commentsPrior) },
      reactions: { value: reactionsCurrent, changePct: deltaPct(reactionsCurrent, reactionsPrior) },
      shares: { value: sharesCurrent, changePct: deltaPct(sharesCurrent, sharesPrior) },
      chatMessages: { value: chatCurrent, changePct: deltaPct(chatCurrent, chatPrior) },
      announcementReach: { value: reachVal, changePct: deltaPct(reachVal, reachPriorVal) },
    };
  }

  // ── Experiences Impact ─────────────────────────────────────────────────────

  private async getExperiencesImpact(communityId: string, window30Start: Date, window60Start: Date) {
    const communityEventFilter = { event: { communities: { some: { communityId } } } };

    const [bookingsCurrent, bookingsPrior, topExperiences] = await Promise.all([
      this.prisma.order.count({
        where: { status: OrderStatus.CONFIRMED, confirmedAt: { gte: window30Start }, ...communityEventFilter },
      }),
      this.prisma.order.count({
        where: {
          status: OrderStatus.CONFIRMED,
          confirmedAt: { gte: window60Start, lt: window30Start },
          ...communityEventFilter,
        },
      }),
      this.prisma.$queryRawUnsafe<TopExpRow[]>(
        `SELECT
           e.id,
           e.title,
           COUNT(DISTINCT o.id)::int                                                     AS bookings,
           COALESCE(SUM(o."totalAmount")::float8, 0)                                    AS revenue,
           ROUND(
             COUNT(oa.id) FILTER (WHERE oa."checkedInAt" IS NOT NULL)::numeric
             * 100.0 / NULLIF(COUNT(oa.id), 0), 1
           )::float                                                                      AS "attendancePct"
         FROM "community_events" ce
         JOIN "events" e  ON e.id = ce."eventId"
         JOIN "orders" o  ON o."eventId" = e.id
                         AND o.status = 'CONFIRMED'
                         AND o."confirmedAt" >= $2
         LEFT JOIN "order_items" oi ON oi."orderId" = o.id
         LEFT JOIN "order_attendees" oa ON oa."orderItemId" = oi.id
         WHERE ce."communityId" = $1
         GROUP BY e.id, e.title
         ORDER BY bookings DESC
         LIMIT 5`,
        communityId,
        window30Start,
      ),
    ]);

    return {
      totalBookings: { value: bookingsCurrent, changePct: deltaPct(bookingsCurrent, bookingsPrior) },
      topExperiences: topExperiences.map((r) => ({
        id: r.id,
        title: r.title ?? '(Untitled)',
        bookings: Number(r.bookings),
        revenue: Number(r.revenue),
        attendancePct: r.attendancePct != null ? Number(r.attendancePct) : null,
      })),
    };
  }

  // ── Health Score ───────────────────────────────────────────────────────────

  private async getDeletedRateData(communityId: string) {
    const [totalPosts, deletedPosts, totalComments, deletedComments] = await Promise.all([
      this.prisma.communityPost.count({ where: { communityId } }),
      this.prisma.communityPost.count({ where: { communityId, deletedAt: { not: null } } }),
      this.prisma.communityPostComment.count({ where: { post: { communityId } } }),
      this.prisma.communityPostComment.count({ where: { post: { communityId }, deletedAt: { not: null } } }),
    ]);
    const totalContent = totalPosts + totalComments;
    return { deletedRate: totalContent > 0 ? (deletedPosts + deletedComments) / totalContent : 0 };
  }

  private computeHealthScore(data: {
    activeMembers: number;
    retentionPct: number;
    totalEngagement: number;
    growthRatePct: number;
    attendances: number[];
    deletedRate: number;
  }) {
    // Factor 1 — member growth /20 (≥30% net growth → 20)
    const memberGrowth = Math.min(20, Math.max(0, Math.round(Math.max(data.growthRatePct, 0) / 1.5)));

    // Factor 2 — engagement per active member /20 (≥5 actions/member → 20)
    const engagementPerMember = data.totalEngagement / Math.max(data.activeMembers, 1);
    const engagement = Math.min(20, Math.max(0, Math.round(engagementPerMember * 4)));

    // Factor 3 — event attendance /20 (80%+ avg → 20)
    const avgAttendance =
      data.attendances.length > 0
        ? data.attendances.reduce((a, b) => a + b, 0) / data.attendances.length
        : 0;
    const eventAttendance = Math.min(20, Math.max(0, Math.round(avgAttendance / 4)));

    // Factor 4 — low deletion rate as proxy for report rate /20 (0% deletion → 20)
    const reportRate = Math.min(20, Math.max(0, Math.round((1 - data.deletedRate) * 20)));

    // Factor 5 — retention /20 (100% retention → 20)
    const retention = Math.min(20, Math.max(0, Math.round(data.retentionPct / 5)));

    const total = memberGrowth + engagement + eventAttendance + reportRate + retention;

    let rating: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'NEEDS_ATTENTION';
    if (total >= 90) rating = 'EXCELLENT';
    else if (total >= 75) rating = 'GOOD';
    else if (total >= 60) rating = 'FAIR';
    else rating = 'NEEDS_ATTENTION';

    return {
      total,
      rating,
      factors: { memberGrowth, engagement, eventAttendance, reportRate, retention },
    };
  }

  // ── Member Insights ────────────────────────────────────────────────────────

  private async getMemberInsights(communityId: string) {
    const [activeCount, interestRows, cityRows, ageRows] = await Promise.all([
      this.prisma.communityMember.count({ where: { communityId, status: CommunityMemberStatus.ACTIVE } }),
      this.prisma.$queryRawUnsafe<InterestRow[]>(
        `SELECT i.name, COUNT(DISTINCT cm."userId")::int AS cnt
         FROM "community_members" cm
         JOIN "community_interests" ci ON ci."communityId" = cm."communityId"
         JOIN "interest_categories" ic ON ic."interestId" = ci."interestId"
         JOIN "community_events" ce    ON ce."communityId" = cm."communityId"
         JOIN "events" e               ON e.id = ce."eventId" AND e."categoryId" = ic."categoryId"
         JOIN "event_tickets" t        ON t."eventId" = e.id
         JOIN "order_items" oi         ON oi."ticketId" = t.id
         JOIN "orders" o               ON o.id = oi."orderId" AND o.status = 'CONFIRMED'
         JOIN "order_attendees" oa     ON oa."orderItemId" = oi.id AND oa."userId" = cm."userId"
         JOIN "interests" i            ON i.id = ci."interestId"
         WHERE cm."communityId" = $1 AND cm.status = 'ACTIVE'
         GROUP BY i.name
         ORDER BY cnt DESC`,
        communityId,
      ),
      this.prisma.$queryRawUnsafe<CityRow[]>(
        `SELECT ap.city, COUNT(*)::int AS count
         FROM "community_members" cm
         JOIN "attendee_profiles" ap ON ap."userId" = cm."userId"
         WHERE cm."communityId" = $1 AND cm.status = 'ACTIVE' AND ap.city IS NOT NULL
         GROUP BY ap.city
         ORDER BY count DESC
         LIMIT 5`,
        communityId,
      ),
      this.prisma.$queryRawUnsafe<AgeRow[]>(
        `SELECT ap."ageRange", COUNT(*)::int AS count
         FROM "community_members" cm
         JOIN "attendee_profiles" ap ON ap."userId" = cm."userId"
         WHERE cm."communityId" = $1 AND cm.status = 'ACTIVE' AND ap."ageRange" IS NOT NULL
         GROUP BY ap."ageRange"
         ORDER BY ap."ageRange"`,
        communityId,
      ),
    ]);

    const cityTotal = cityRows.reduce((s, r) => s + Number(r.count), 0);
    const ageTotal = ageRows.reduce((s, r) => s + Number(r.count), 0);

    return {
      interests: interestRows.map((r) => ({
        name: r.name,
        pct: activeCount > 0 ? Math.round((Number(r.cnt) / activeCount) * 100) : 0,
      })),
      topCities: cityRows.map((r) => ({
        city: r.city,
        pct: cityTotal > 0 ? Math.round((Number(r.count) / cityTotal) * 100) : 0,
      })),
      ageDistribution: ageRows.map((r) => ({
        range: r.ageRange,
        label: AGE_RANGE_LABELS[r.ageRange],
        pct: ageTotal > 0 ? Math.round((Number(r.count) / ageTotal) * 100) : 0,
      })),
    };
  }

  // ── Top Contributors ───────────────────────────────────────────────────────

  private async getTopContributors(communityId: string) {
    const rows = await this.prisma.communityMember.findMany({
      where: { communityId, status: CommunityMemberStatus.ACTIVE },
      orderBy: { activityScore: 'desc' },
      take: 5,
      select: {
        activityScore: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
            attendeeProfile: { select: { username: true } },
          },
        },
      },
    });

    return Promise.all(
      rows.map(async (m) => ({
        userId: m.user.id,
        name: `${m.user.firstName} ${m.user.lastName}`,
        handle: m.user.attendeeProfile?.username ?? null,
        avatarUrl: m.user.avatarUrl
          ? await this.storage.getPresignedDownloadUrl(m.user.avatarUrl)
          : null,
        activityScore: m.activityScore,
      })),
    );
  }

  // ── Top Hosts ──────────────────────────────────────────────────────────────

  private async getTopHosts(communityId: string) {
    const hostMembers = await this.prisma.communityMember.findMany({
      where: { communityId, role: CommunityRole.HOST, status: CommunityMemberStatus.ACTIVE },
      select: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
            hostProfile: { select: { id: true } },
            attendeeProfile: { select: { username: true } },
          },
        },
      },
    });

    const withCounts = await Promise.all(
      hostMembers.map(async (m) => {
        const hostProfileId = m.user.hostProfile?.id;
        const eventCount = hostProfileId
          ? await this.prisma.communityEvent.count({
              where: { communityId, event: { hostProfileId } },
            })
          : 0;
        return { user: m.user, eventCount };
      }),
    );

    const top3 = withCounts.sort((a, b) => b.eventCount - a.eventCount).slice(0, 3);

    return Promise.all(
      top3.map(async (h) => ({
        userId: h.user.id,
        name: `${h.user.firstName} ${h.user.lastName}`,
        handle: h.user.attendeeProfile?.username ?? null,
        avatarUrl: h.user.avatarUrl
          ? await this.storage.getPresignedDownloadUrl(h.user.avatarUrl)
          : null,
        eventCount: h.eventCount,
      })),
    );
  }

  // ── Utility ────────────────────────────────────────────────────────────────

  private toDaily(rows: DailyRow[], since: Date): number[] {
    const buckets = new Array<number>(WINDOW_DAYS).fill(0);
    const startDay = new Date(since);
    startDay.setHours(0, 0, 0, 0);
    for (const r of rows) {
      const idx = Math.floor((new Date(r.day).getTime() - startDay.getTime()) / DAY);
      if (idx >= 0 && idx < WINDOW_DAYS) buckets[idx] = Number(r.count);
    }
    return buckets;
  }
}
