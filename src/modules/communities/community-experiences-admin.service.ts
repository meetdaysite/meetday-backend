import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import type { ExperienceStatusFilter } from './dto/list-community-experiences-query.dto';
import { ListCommunityExperiencesQueryDto } from './dto/list-community-experiences-query.dto';

type ComputedStatus = 'UPCOMING' | 'LIVE' | 'COMPLETED' | 'DRAFT' | 'CANCELLED';

interface SidebarTotalsRow {
  bookings_current: number;
  bookings_prior: number;
  revenue_current: number;
  revenue_prior: number;
  attendance_current: number | null;
  attendance_prior: number | null;
}

interface TopExpRow {
  id: string;
  title: string;
  bookings: number;
  revenue: number;
}

const deltaPct = (current: number, prior: number) =>
  Math.round(((current - prior) / Math.max(prior, 1)) * 100);

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

function computedStatus(
  dbStatus: string,
  eventDate: Date | null,
  todayStart: Date,
  todayEnd: Date,
): ComputedStatus {
  if (dbStatus === 'CANCELLED') return 'CANCELLED';
  if (dbStatus === 'DRAFT' || dbStatus === 'UNDER_REVIEW') return 'DRAFT';
  if (!eventDate) return 'DRAFT';
  if (eventDate >= todayStart && eventDate <= todayEnd) return 'LIVE';
  if (eventDate > todayEnd) return 'UPCOMING';
  return 'COMPLETED';
}

@Injectable()
export class CommunityExperiencesAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async listExperiences(communityId: string, query: ListCommunityExperiencesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const sort = query.sort ?? 'NEWEST_FIRST';
    const statusFilter = query.status ?? 'ALL';

    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const window30Start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const window60Start = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const communityFilter = { event: { communities: { some: { communityId } } } };

    // ── A. All-time stats + B. Tab counts ─────────────────────────────────────
    const [
      totalExperiences,
      upcomingCount,
      completedCount,
      totalBookings,
      revenueAgg,
      tabAll,
      tabUpcoming,
      tabLive,
      tabCompleted,
      tabDrafts,
      tabCancelled,
    ] = await Promise.all([
      this.prisma.communityEvent.count({ where: { communityId } }),
      this.prisma.communityEvent.count({
        where: { communityId, event: { status: 'PUBLISHED', eventDate: { gte: now } } },
      }),
      this.prisma.communityEvent.count({
        where: { communityId, event: { status: 'PUBLISHED', eventDate: { lt: now } } },
      }),
      this.prisma.order.count({ where: { status: 'CONFIRMED', ...communityFilter } }),
      this.prisma.order.aggregate({
        where: { status: 'CONFIRMED', ...communityFilter },
        _sum: { totalAmount: true },
      }),
      // tab counts
      this.prisma.communityEvent.count({ where: { communityId } }),
      this.prisma.communityEvent.count({
        where: { communityId, event: { status: 'PUBLISHED', eventDate: { gt: todayEnd } } },
      }),
      this.prisma.communityEvent.count({
        where: {
          communityId,
          event: { status: 'PUBLISHED', eventDate: { gte: todayStart, lte: todayEnd } },
        },
      }),
      this.prisma.communityEvent.count({
        where: { communityId, event: { status: 'PUBLISHED', eventDate: { lt: todayStart } } },
      }),
      this.prisma.communityEvent.count({
        where: { communityId, event: { status: { in: ['DRAFT', 'UNDER_REVIEW'] } } },
      }),
      this.prisma.communityEvent.count({
        where: { communityId, event: { status: 'CANCELLED' } },
      }),
    ]);

    // ── C. Paginated experience list ───────────────────────────────────────────
    const searchWhere: Prisma.EventWhereInput = query.search
      ? { title: { contains: query.search, mode: 'insensitive' } }
      : {};

    const statusWhere = this.buildStatusWhere(statusFilter, todayStart, todayEnd);

    const eventWhere: Prisma.EventWhereInput = { ...searchWhere, ...statusWhere };

    const isAggregateSorted =
      sort === 'MOST_BOOKINGS' || sort === 'REVENUE';

    const prismaOrderBy: Prisma.CommunityEventOrderByWithRelationInput = isAggregateSorted
      ? { event: { eventDate: 'desc' } }
      : sort === 'OLDEST'
        ? { event: { eventDate: 'asc' } }
        : { event: { eventDate: 'desc' } };

    // For aggregate sorts: fetch all, compute, sort, paginate in memory
    // For date sorts: use DB-level skip/take
    const allRows = await this.prisma.communityEvent.findMany({
      where: { communityId, event: eventWhere },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            status: true,
            eventDate: true,
            startTime: true,
            endTime: true,
            visibility: true,
            tags: true,
            media: { where: { type: 'COVER' }, orderBy: { order: 'asc' }, take: 1, select: { url: true } },
          },
        },
      },
      orderBy: prismaOrderBy,
      ...(!isAggregateSorted ? { skip: (page - 1) * limit, take: limit } : {}),
    });

    const totalForStatus = isAggregateSorted
      ? allRows.length
      : await this.prisma.communityEvent.count({ where: { communityId, event: eventWhere } });

    // Aggregate bookings + revenue per event (for all fetched rows, then slice)
    const allEventIds = allRows.map((r) => r.eventId);
    const [orderAggs, ticketAggs] = await Promise.all([
      allEventIds.length > 0
        ? this.prisma.order.groupBy({
            by: ['eventId'],
            where: { eventId: { in: allEventIds }, status: 'CONFIRMED' },
            _count: { id: true },
            _sum: { totalAmount: true },
          })
        : Promise.resolve([]),
      allEventIds.length > 0
        ? this.prisma.eventTicket.groupBy({
            by: ['eventId'],
            where: { eventId: { in: allEventIds } },
            _sum: { totalCapacity: true },
          })
        : Promise.resolve([]),
    ]);

    const orderMap = new Map(
      orderAggs.map((o) => [
        o.eventId,
        { count: o._count.id, revenue: Number(o._sum.totalAmount ?? 0) },
      ]),
    );
    const ticketMap = new Map(
      ticketAggs.map((t) => [t.eventId, Number(t._sum.totalCapacity ?? 0)]),
    );

    // Sort by aggregate if needed, then paginate
    let pageRows = allRows;
    if (isAggregateSorted) {
      pageRows = [...allRows].sort((a, b) => {
        if (sort === 'MOST_BOOKINGS') {
          return (orderMap.get(b.eventId)?.count ?? 0) - (orderMap.get(a.eventId)?.count ?? 0);
        }
        return (orderMap.get(b.eventId)?.revenue ?? 0) - (orderMap.get(a.eventId)?.revenue ?? 0);
      });
      pageRows = pageRows.slice((page - 1) * limit, page * limit);
    }

    // Sign cover images for the page
    const experiences = await Promise.all(
      pageRows.map(async (row) => {
        const event = row.event;
        const coverKey = event.media[0]?.url ?? null;
        const coverUrl = coverKey ? await this.storage.getPresignedDownloadUrl(coverKey) : null;
        const confirmed = orderMap.get(row.eventId)?.count ?? 0;
        const capacity = ticketMap.get(row.eventId) ?? 0;
        const pct = capacity > 0 ? Math.round((confirmed / capacity) * 100) : 0;

        return {
          id: event.id,
          title: event.title,
          coverUrl,
          tags: event.tags,
          eventDate: event.eventDate,
          startTime: event.startTime,
          computedStatus: computedStatus(event.status, event.eventDate, todayStart, todayEnd),
          dbStatus: event.status,
          bookings: { confirmed, capacity, pct },
          revenue: orderMap.get(row.eventId)?.revenue ?? 0,
          visibility: event.visibility,
          source: row.source,
        };
      }),
    );

    // ── D. Sidebar ─────────────────────────────────────────────────────────────
    const sidebar = await this.getSidebar(communityId, window30Start, window60Start);

    return {
      stats: {
        totalExperiences,
        upcoming: upcomingCount,
        completed: completedCount,
        totalBookings,
        totalRevenue: Number(revenueAgg._sum.totalAmount ?? 0),
      },
      tabCounts: {
        all: tabAll,
        upcoming: tabUpcoming,
        live: tabLive,
        completed: tabCompleted,
        drafts: tabDrafts,
        cancelled: tabCancelled,
      },
      experiences,
      total: isAggregateSorted ? totalForStatus : totalForStatus,
      page,
      limit,
      sidebar,
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private buildStatusWhere(
    filter: ExperienceStatusFilter,
    todayStart: Date,
    todayEnd: Date,
  ): Prisma.EventWhereInput {
    switch (filter) {
      case 'UPCOMING':
        return { status: 'PUBLISHED', eventDate: { gt: todayEnd } };
      case 'LIVE':
        return { status: 'PUBLISHED', eventDate: { gte: todayStart, lte: todayEnd } };
      case 'COMPLETED':
        return { status: 'PUBLISHED', eventDate: { lt: todayStart } };
      case 'DRAFT':
        return { status: { in: ['DRAFT', 'UNDER_REVIEW'] } };
      case 'CANCELLED':
        return { status: 'CANCELLED' };
      default:
        return {};
    }
  }

  private async getSidebar(communityId: string, window30Start: Date, window60Start: Date) {
    const [totalsRows, topExpRows] = await Promise.all([
      this.prisma.$queryRawUnsafe<SidebarTotalsRow[]>(
        `SELECT
           COUNT(o.id) FILTER (WHERE o."confirmedAt" >= $2)::int                    AS bookings_current,
           COUNT(o.id) FILTER (WHERE o."confirmedAt" >= $3 AND o."confirmedAt" < $2)::int AS bookings_prior,
           COALESCE(SUM(o."totalAmount") FILTER (WHERE o."confirmedAt" >= $2), 0)::float8   AS revenue_current,
           COALESCE(SUM(o."totalAmount") FILTER (WHERE o."confirmedAt" >= $3 AND o."confirmedAt" < $2), 0)::float8 AS revenue_prior,
           ROUND(
             COUNT(oa.id) FILTER (WHERE oa."checkedInAt" IS NOT NULL AND o."confirmedAt" >= $2)::numeric
             * 100.0 / NULLIF(COUNT(oa.id) FILTER (WHERE o."confirmedAt" >= $2), 0), 1
           )::float8  AS attendance_current,
           ROUND(
             COUNT(oa.id) FILTER (WHERE oa."checkedInAt" IS NOT NULL AND o."confirmedAt" >= $3 AND o."confirmedAt" < $2)::numeric
             * 100.0 / NULLIF(COUNT(oa.id) FILTER (WHERE o."confirmedAt" >= $3 AND o."confirmedAt" < $2), 0), 1
           )::float8  AS attendance_prior
         FROM "community_events" ce
         JOIN "orders" o ON o."eventId" = ce."eventId" AND o.status = 'CONFIRMED'
         LEFT JOIN "order_items" oi ON oi."orderId" = o.id
         LEFT JOIN "order_attendees" oa ON oa."orderItemId" = oi.id
         WHERE ce."communityId" = $1`,
        communityId,
        window30Start,
        window60Start,
      ),
      this.prisma.$queryRawUnsafe<TopExpRow[]>(
        `SELECT
           e.id,
           e.title,
           COUNT(DISTINCT o.id)::int                              AS bookings,
           COALESCE(SUM(o."totalAmount")::float8, 0)             AS revenue
         FROM "community_events" ce
         JOIN "events" e ON e.id = ce."eventId"
         JOIN "orders" o ON o."eventId" = e.id AND o.status = 'CONFIRMED' AND o."confirmedAt" >= $2
         WHERE ce."communityId" = $1
         GROUP BY e.id, e.title
         ORDER BY bookings DESC
         LIMIT 3`,
        communityId,
        window30Start,
      ),
    ]);

    const t = totalsRows[0];
    const bookingsCurrent = t ? Number(t.bookings_current) : 0;
    const bookingsPrior = t ? Number(t.bookings_prior) : 0;
    const revenueCurrent = t ? Number(t.revenue_current) : 0;
    const revenuePrior = t ? Number(t.revenue_prior) : 0;
    const attCurrent = t?.attendance_current != null ? Number(t.attendance_current) : null;
    const attPrior = t?.attendance_prior != null ? Number(t.attendance_prior) : null;

    // Fetch cover images for top 3
    const topEventIds = topExpRows.map((r) => r.id);
    const topCovers = topEventIds.length > 0
      ? await this.prisma.eventMedia.findMany({
          where: { eventId: { in: topEventIds }, type: 'COVER' },
          orderBy: { order: 'asc' },
          select: { eventId: true, url: true },
          distinct: ['eventId'],
        })
      : [];
    const coverKeyMap = new Map(topCovers.map((m) => [m.eventId, m.url]));

    const topExperiences = await Promise.all(
      topExpRows.map(async (r) => {
        const coverKey = coverKeyMap.get(r.id) ?? null;
        const coverUrl = coverKey ? await this.storage.getPresignedDownloadUrl(coverKey) : null;
        return {
          id: r.id,
          title: r.title,
          coverUrl,
          bookings: Number(r.bookings),
          revenue: Number(r.revenue),
        };
      }),
    );

    return {
      performance30d: {
        bookings: { value: bookingsCurrent, deltaPct: deltaPct(bookingsCurrent, bookingsPrior) },
        revenue: { value: revenueCurrent, deltaPct: deltaPct(revenueCurrent, revenuePrior) },
        attendanceRate: {
          value: attCurrent,
          deltaPct:
            attCurrent !== null && attPrior !== null
              ? deltaPct(Math.round(attCurrent), Math.round(attPrior))
              : 0,
        },
      },
      topExperiences,
    };
  }
}
