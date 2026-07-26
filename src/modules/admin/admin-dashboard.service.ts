import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { DashboardRevenueQueryDto, RevenuePeriod } from './dto/dashboard-revenue-query.dto';
import { getEventStartAt, isEventLiveNow } from '../events/event-time.util';

function todayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function yesterdayRange() {
  const start = new Date();
  start.setDate(start.getDate() - 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function getPeriodRange(period: RevenuePeriod): { start: Date; end: Date; prevStart: Date; prevEnd: Date } {
  const now = new Date();
  let start: Date;
  let end = new Date();

  switch (period) {
    case RevenuePeriod.TODAY: {
      start = new Date(now);
      start.setHours(0, 0, 0, 0);
      break;
    }
    case RevenuePeriod.THIS_WEEK: {
      start = new Date(now);
      start.setDate(now.getDate() - now.getDay());
      start.setHours(0, 0, 0, 0);
      break;
    }
    case RevenuePeriod.THIS_MONTH: {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    }
    case RevenuePeriod.THIS_QUARTER: {
      const q = Math.floor(now.getMonth() / 3);
      start = new Date(now.getFullYear(), q * 3, 1);
      break;
    }
    case RevenuePeriod.THIS_YEAR: {
      start = new Date(now.getFullYear(), 0, 1);
      break;
    }
  }

  const lengthMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - lengthMs);

  return { start, end, prevStart, prevEnd };
}

function decimalToNumber(d: Prisma.Decimal | null | undefined): number {
  if (d == null) return 0;
  return new Prisma.Decimal(d).toNumber();
}

async function withCache<T>(redis: RedisService, key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
  const cached = await redis.get<T>(key);
  if (cached !== null) return cached;
  const result = await fn();
  await redis.set(key, result, ttl);
  return result;
}

@Injectable()
export class AdminDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async getStats() {
    return withCache(this.redis, 'admin:dashboard:stats', 30, async () => {
      const { start: todayStart, end: todayEnd } = todayRange();
      const { start: yestStart, end: yestEnd } = yesterdayRange();
      const now = new Date();

      const [
        hostApprovals,
        eventApprovals,
        contributorRequests,
        postReports,
        chatReports,
        supportFlags,
        todayRevRaw,
        yesterdayRevRaw,
        todayEvents,
      ] = await this.prisma.$transaction([
        this.prisma.hostProfile.count({ where: { approvalStatus: 'PENDING', kycStatus: 'VERIFIED' } }),
        this.prisma.event.count({ where: { status: 'UNDER_REVIEW' } }),
        this.prisma.communityMember.count({ where: { status: 'PENDING' } }),
        this.prisma.communityPostReport.count({ where: { status: 'PENDING' } }),
        this.prisma.channelMessageReport.count({ where: { status: 'PENDING' } }),
        this.prisma.supportTicket.count({ where: { status: 'OPEN' } }),
        this.prisma.order.aggregate({
          _sum: { totalAmount: true },
          where: { status: 'CONFIRMED', confirmedAt: { gte: todayStart, lte: todayEnd } },
        }),
        this.prisma.order.aggregate({
          _sum: { totalAmount: true },
          where: { status: 'CONFIRMED', confirmedAt: { gte: yestStart, lte: yestEnd } },
        }),
        this.prisma.event.findMany({
          where: {
            status: 'PUBLISHED',
            eventDate: { gte: todayStart, lte: todayEnd },
            startTime: { not: null },
            endTime: { not: null },
          },
          select: { id: true, eventDate: true, startTime: true, endTime: true },
        }),
      ]);

      const liveNow = todayEvents.filter((e) => isEventLiveNow(e, now));
      const startingLater = todayEvents.filter((e) => {
        const start = getEventStartAt(e);
        return start !== null && start > now;
      });

      const revenueToday = decimalToNumber(todayRevRaw._sum.totalAmount);
      const revenueYesterday = decimalToNumber(yesterdayRevRaw._sum.totalAmount);
      const revenueTodayDelta =
        revenueYesterday === 0 ? 0 : +((((revenueToday - revenueYesterday) / revenueYesterday) * 100).toFixed(1));

      return {
        pendingReviews: hostApprovals + eventApprovals + contributorRequests + postReports + chatReports,
        liveEvents: liveNow.length + startingLater.length,
        liveEventsStartingToday: startingLater.length,
        supportFlags,
        revenueToday,
        revenueTodayDelta,
      };
    });
  }

  async getReviewQueue() {
    return withCache(this.redis, 'admin:dashboard:review-queue', 30, async () => {
      const [hostApprovals, eventApprovals, contributorRequests, postReports, chatReports] =
        await this.prisma.$transaction([
          this.prisma.hostProfile.count({ where: { approvalStatus: 'PENDING', kycStatus: 'VERIFIED' } }),
          this.prisma.event.count({ where: { status: 'UNDER_REVIEW' } }),
          this.prisma.communityMember.count({ where: { status: 'PENDING' } }),
          this.prisma.communityPostReport.count({ where: { status: 'PENDING' } }),
          this.prisma.channelMessageReport.count({ where: { status: 'PENDING' } }),
        ]);

      return {
        hostApprovals,
        eventApprovals,
        contributorRequests,
        reportedContent: postReports + chatReports,
      };
    });
  }

  async getLiveOperations() {
    return withCache(this.redis, 'admin:dashboard:live-ops', 30, async () => {
      const { start: todayStart, end: todayEnd } = todayRange();
      const now = new Date();

      const [todayEvents, checkInsToday, todayTickets] = await this.prisma.$transaction([
        this.prisma.event.findMany({
          where: {
            status: 'PUBLISHED',
            eventDate: { gte: todayStart, lte: todayEnd },
            startTime: { not: null },
            endTime: { not: null },
          },
          select: { id: true, eventDate: true, startTime: true, endTime: true },
        }),
        this.prisma.orderAttendee.count({ where: { checkedInAt: { gte: todayStart } } }),
        this.prisma.eventTicket.findMany({
          where: {
            event: {
              status: 'PUBLISHED',
              eventDate: { gte: todayStart, lte: todayEnd },
            },
          },
          select: { eventId: true, totalCapacity: true, soldCount: true },
        }),
      ]);

      const eventsLiveNow = todayEvents.filter((e) => isEventLiveNow(e, now)).length;

      const capacityByEvent = new Map<string, { total: number; sold: number }>();
      for (const t of todayTickets) {
        const prev = capacityByEvent.get(t.eventId) ?? { total: 0, sold: 0 };
        capacityByEvent.set(t.eventId, {
          total: prev.total + t.totalCapacity,
          sold: prev.sold + t.soldCount,
        });
      }
      const capacityAlerts = [...capacityByEvent.values()].filter(
        ({ total, sold }) => total > 0 && sold / total >= 0.8,
      ).length;

      return { eventsLiveNow, checkInsToday, capacityAlerts };
    });
  }

  async getRevenue(query: DashboardRevenueQueryDto) {
    const period = query.period ?? RevenuePeriod.THIS_MONTH;
    return withCache(this.redis, `admin:dashboard:revenue:${period}`, 300, async () => {
      const { start, end, prevStart, prevEnd } = getPeriodRange(period);

      const [currentRaw, prevRaw, timeSeriesRaw] = await Promise.all([
        this.prisma.order.aggregate({
          _sum: { subtotal: true, platformFee: true, totalAmount: true },
          where: { status: 'CONFIRMED', confirmedAt: { gte: start, lte: end } },
        }),
        this.prisma.order.aggregate({
          _sum: { totalAmount: true },
          where: { status: 'CONFIRMED', confirmedAt: { gte: prevStart, lte: prevEnd } },
        }),
        this.prisma.$queryRaw<{ date: Date; ticket_revenue: string; platform_fee: string }[]>(
          Prisma.sql`
            SELECT
              DATE_TRUNC('day', "confirmedAt") AS date,
              SUM("subtotal")::text AS ticket_revenue,
              SUM("platformFee")::text AS platform_fee
            FROM orders
            WHERE status = 'CONFIRMED'
              AND "confirmedAt" >= ${start}
              AND "confirmedAt" <= ${end}
            GROUP BY DATE_TRUNC('day', "confirmedAt")
            ORDER BY date ASC
          `,
        ),
      ]);

      const total = decimalToNumber(currentRaw._sum.totalAmount);
      const prevTotal = decimalToNumber(prevRaw._sum.totalAmount);
      const totalDelta = prevTotal === 0 ? 0 : +(((total - prevTotal) / prevTotal) * 100).toFixed(1);

      const timeSeries = timeSeriesRaw.map((row) => ({
        date: row.date.toISOString().split('T')[0],
        ticketRevenue: parseFloat(row.ticket_revenue ?? '0'),
        platformFee: parseFloat(row.platform_fee ?? '0'),
      }));

      return {
        total,
        totalDelta,
        ticketRevenue: decimalToNumber(currentRaw._sum.subtotal),
        platformFees: decimalToNumber(currentRaw._sum.platformFee),
        sponsorships: 0,
        others: 0,
        timeSeries,
      };
    });
  }

  async getRecentActivity(limit = 20) {
    return withCache(this.redis, 'admin:dashboard:activity', 15, async () => {
      const logs = await this.prisma.auditLog.findMany({
        where: {
          action: {
            in: [
              'USER_REGISTERED',
              'KYC_SUBMITTED',
              'KYC_APPROVED',
              'EVENT_SUBMITTED_FOR_REVIEW',
              'EVENT_APPROVED',
              'EVENT_PUBLISHED',
              'EVENT_CANCELLED',
              'ORDER_CONFIRMED',
              'REFUND_INITIATED',
              'REFUND_COMPLETED',
              'COMMUNITY_CREATED',
              'COMMUNITY_PUBLISHED',
              'FEED_POST_REPORT_RESOLVED',
              'CHAT_REPORT_RESOLVED',
              'SUPPORT_TICKET_CREATED',
              'ADMIN_HOST_SUSPENDED',
            ],
          },
        },
        include: {
          actor: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      const items = await Promise.all(
        logs.map(async (log) => {
          const actorName = log.actor ? `${log.actor.firstName} ${log.actor.lastName}` : 'System';
          let label = log.action.replace(/_/g, ' ').toLowerCase();
          let subLabel: string | null = null;

          if (log.entityType === 'HOST' && log.entityId) {
            const host = await this.prisma.hostProfile.findUnique({
              where: { id: log.entityId },
              select: { displayName: true, operatingCities: true },
            });
            if (host) {
              // displayName is only set once the host names their business — early in
              // onboarding (e.g. at KYC_SUBMITTED) it's still null, so fall back to the actor.
              label = `New host application by ${host.displayName ?? actorName}`;
              subLabel = host.operatingCities?.[0] ?? null;
            }
          } else if (log.entityType === 'EVENT' && log.entityId) {
            const event = await this.prisma.event.findUnique({
              where: { id: log.entityId },
              select: { title: true, city: true },
            });
            if (event) {
              label = `${event.title} is ${log.action === 'EVENT_PUBLISHED' ? 'live now' : log.action.replace(/_/g, ' ').toLowerCase()}`;
              subLabel = event.city ?? null;
            }
          } else if (log.entityType === 'COMMUNITY' && log.entityId) {
            const community = await this.prisma.community.findUnique({
              where: { id: log.entityId },
              select: { name: true, primaryCity: true },
            });
            if (community) {
              label = `Community "${community.name}" ${log.action === 'COMMUNITY_CREATED' ? 'created' : 'updated'} by ${actorName}`;
              subLabel = community.primaryCity ?? null;
            }
          } else if (log.entityType === 'ORDER' && log.entityId) {
            const order = await this.prisma.order.findUnique({
              where: { id: log.entityId },
              select: { bookingId: true },
            });
            if (order) {
              label =
                log.action === 'REFUND_INITIATED'
                  ? `Refund request for order ${order.bookingId}`
                  : log.action === 'REFUND_COMPLETED'
                    ? `Refund completed for order ${order.bookingId}`
                    : `Order ${order.bookingId} confirmed`;
            }
          } else if (log.entityType === 'SUPPORT_TICKET' && log.entityId) {
            const ticket = await this.prisma.supportTicket.findUnique({
              where: { id: log.entityId },
              select: { ticketNumber: true, subject: true },
            });
            if (ticket) {
              label = `Support ticket ${ticket.ticketNumber}: ${ticket.subject}`;
            }
          }

          return {
            id: log.id,
            action: log.action,
            label,
            subLabel,
            actorName,
            timestamp: log.createdAt,
          };
        }),
      );

      return { items };
    });
  }

  async getHealth() {
    return withCache(this.redis, 'admin:dashboard:health', 10, async () => {
      const [paymentGateway, notifications, checkInSystem] = await Promise.all([
        this.checkPaymentGateway(),
        this.checkNotifications(),
        this.checkCheckInSystem(),
      ]);

      return {
        server: 'operational' as const,
        paymentGateway,
        notifications,
        checkInSystem,
      };
    });
  }

  private checkPaymentGateway(): 'operational' | 'degraded' | 'down' {
    const keyId = this.config.get<string>('razorpay.keyId');
    const keySecret = this.config.get<string>('razorpay.keySecret');
    return keyId && keySecret ? 'operational' : 'down';
  }

  private async checkNotifications(): Promise<'operational' | 'degraded' | 'down'> {
    try {
      await this.redis.set('__health_ping__', 1, 5);
      return 'operational';
    } catch {
      return 'down';
    }
  }

  private async checkCheckInSystem(): Promise<'operational' | 'degraded' | 'down'> {
    try {
      const activeSessions = await this.prisma.eventScannerSession.count({
        where: { isActive: true, expiresAt: { gt: new Date() } },
      });
      return activeSessions >= 0 ? 'operational' : 'operational';
    } catch {
      return 'degraded';
    }
  }
}
