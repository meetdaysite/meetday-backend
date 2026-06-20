import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EventsVibeService } from '../events/events-vibe.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { AuditLogService } from '../audit-log/audit-log.service';

async function generateUniqueBookingId(
  check: (id: string) => Promise<boolean>,
  attempts = 10,
): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    const a = randomBytes(2).toString('hex').toUpperCase();
    const b = randomBytes(2).toString('hex').toUpperCase();
    const id = `MDAY-${a}-${b}`;
    if (await check(id)) return id;
  }
  throw new Error('Failed to generate unique booking ID');
}

const GST_RATE = 0.18;
const PENDING_EXPIRY_MINUTES = 15;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly configService: ConfigService,
    @InjectQueue('mail') private readonly mailQueue: Queue,
    private readonly auditLogService: AuditLogService,
    private readonly eventsVibeService: EventsVibeService,
  ) {}

  async createOrder(userId: string, dto: CreateOrderDto) {
    const buyer = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true, email: true, phone: true },
    });
    if (!buyer) throw new NotFoundException('User not found');

    const event = await this.prisma.event.findUnique({
      where: { id: dto.eventId },
      select: {
        id: true,
        status: true,
        eventDate: true,
        platformFeeWaived: true,
        hostProfile: {
          select: {
            approvalStatus: true,
            subscriptions: {
              where: { status: 'ACTIVE' },
              select: { lockedFeeRate: true },
              take: 1,
            },
          },
        },
      },
    });

    if (!event) throw new NotFoundException('Event not found');
    if (event.status !== 'PUBLISHED') throw new BadRequestException('Event is not available for booking');
    if (event.hostProfile.approvalStatus === 'SUSPENDED') throw new BadRequestException('Event is not available for booking');
    if (event.eventDate && event.eventDate < new Date()) throw new BadRequestException('Event has already passed');

    const ticketIds = dto.items.map((i) => i.ticketId);
    const tickets = await this.prisma.eventTicket.findMany({
      where: { id: { in: ticketIds }, eventId: dto.eventId },
    });
    if (tickets.length !== ticketIds.length)
      throw new NotFoundException('One or more tickets not found for this event');

    const ticketMap = new Map(tickets.map((t) => [t.id, t]));
    const now = new Date();

    for (const item of dto.items) {
      const ticket = ticketMap.get(item.ticketId)!;

      if (ticket.saleStartDate && ticket.saleStartDate > now)
        throw new BadRequestException(`Ticket "${ticket.name}" sales have not started yet`);
      if (ticket.saleEndDate && ticket.saleEndDate < now)
        throw new BadRequestException(`Ticket "${ticket.name}" sales have ended`);

      if (ticket.maxPerPerson) {
        if (item.quantity > ticket.maxPerPerson)
          throw new BadRequestException(
            `Exceeds maximum tickets per person for "${ticket.name}" (max: ${ticket.maxPerPerson})`,
          );

        const existing = await this.prisma.orderItem.aggregate({
          where: {
            ticketId: ticket.id,
            order: { userId, status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] } },
          },
          _sum: { quantity: true },
        });
        const existingQty = existing._sum.quantity ?? 0;
        if (existingQty + item.quantity > ticket.maxPerPerson)
          throw new BadRequestException(
            `You already have ${existingQty} ticket(s) for "${ticket.name}". Maximum allowed: ${ticket.maxPerPerson}`,
          );
      }

      if (item.quantity > 1) {
        const extras = item.groupAttendees?.length ?? 0;
        if (extras !== item.quantity - 1)
          throw new BadRequestException(
            `Provide attendee details for each additional ticket for "${ticket.name}" ` +
              `(need ${item.quantity - 1}, got ${extras})`,
          );
      }
    }

    // Duplicate attendee email check across all group attendees in this order
    const seenEmails = new Set<string>();
    for (const item of dto.items) {
      for (const a of item.groupAttendees ?? []) {
        if (!a.email) continue;
        if (seenEmails.has(a.email))
          throw new BadRequestException(`Duplicate attendee email in order: ${a.email}`);
        seenEmails.add(a.email);
      }
    }

    // Coupon validation
    let coupon: any = null;
    if (dto.couponCode) {
      coupon = await this.prisma.coupon.findUnique({
        where: { code: dto.couponCode },
        select: {
          id: true,
          target: true,
          discountType: true,
          discountValue: true,
          isActive: true,
          validFrom: true,
          validUntil: true,
          maxUsages: true,
          usageCount: true,
          maxUsagesPerUser: true,
          eventId: true,
        },
      });

      if (!coupon || !coupon.isActive) throw new BadRequestException('Invalid or inactive promo code');
      if (coupon.target !== 'ATTENDEE') throw new BadRequestException('This promo code is not valid for ticket purchases');
      if (coupon.validFrom && coupon.validFrom > now) throw new BadRequestException('Promo code is not yet active');
      if (coupon.validUntil && coupon.validUntil < now) throw new BadRequestException('Promo code has expired');
      if (coupon.maxUsages !== null && coupon.usageCount >= coupon.maxUsages)
        throw new BadRequestException('Promo code usage limit reached');
      if (coupon.eventId && coupon.eventId !== dto.eventId)
        throw new BadRequestException('Promo code is not valid for this event');

      if (coupon.maxUsagesPerUser) {
        const userUsage = await this.prisma.order.count({
          where: { userId, couponId: coupon.id, status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] } },
        });
        if (userUsage >= coupon.maxUsagesPerUser)
          throw new BadRequestException('You have already used this promo code the maximum number of times');
      }
    }

    // Compute financials
    let subtotal = 0;
    for (const item of dto.items) {
      subtotal += Number(ticketMap.get(item.ticketId)!.price) * item.quantity;
    }

    let discountAmount = 0;
    if (coupon) {
      discountAmount =
        coupon.discountType === 'PERCENTAGE'
          ? subtotal * (coupon.discountValue / 100)
          : Math.min(coupon.discountValue, subtotal);
      discountAmount = Math.round(discountAmount * 100) / 100;
    }

    const netSubtotal = subtotal - discountAmount;

    let feeRate = 0;
    if (!event.platformFeeWaived) {
      const activeSub = event.hostProfile.subscriptions[0];
      if (activeSub) {
        feeRate = activeSub.lockedFeeRate;
      } else {
        const plan = await this.prisma.subscriptionPlan.findUnique({
          where: { plan: 'DISCOVER' },
          select: { platformFeeRate: true },
        });
        feeRate = plan?.platformFeeRate ?? 0;
      }
    }

    const platformFee = Math.round(netSubtotal * feeRate * 100) / 100;
    const taxAmount = Math.round((netSubtotal + platformFee) * GST_RATE * 100) / 100;
    const totalAmount = Math.round((netSubtotal + platformFee + taxAmount) * 100) / 100;

    const buyerName = `${buyer.firstName} ${buyer.lastName}`;
    const buyerEmail = buyer.email ?? buyer.phone ?? '';

    // Resolve group attendees to platform accounts by email (social graph identity)
    const groupEmails = [
      ...new Set(
        dto.items.flatMap((item) => (item.groupAttendees ?? []).map((a) => a.email).filter(Boolean)),
      ),
    ];
    const matchedUsers = groupEmails.length
      ? await this.prisma.user.findMany({
          where: { email: { in: groupEmails } },
          select: { id: true, email: true },
        })
      : [];
    const userIdByEmail = new Map(matchedUsers.map((u) => [u.email!, u.id]));

    const bookingId = await generateUniqueBookingId(async (id) => {
      const existing = await this.prisma.order.findUnique({ where: { bookingId: id }, select: { id: true } });
      return !existing;
    });

    // Atomic capacity increment + order creation
    const order = await this.prisma.$transaction(async (tx) => {
      for (const item of dto.items) {
        const ticket = ticketMap.get(item.ticketId)!;
        const updated = await tx.$executeRaw`
          UPDATE event_tickets
          SET "soldCount" = "soldCount" + ${item.quantity}
          WHERE id = ${ticket.id}
            AND "soldCount" + ${item.quantity} <= "totalCapacity"
        `;
        if (updated === 0) {
          const fresh = await tx.eventTicket.findUnique({
            where: { id: ticket.id },
            select: { soldCount: true, totalCapacity: true },
          });
          const available = fresh ? fresh.totalCapacity - fresh.soldCount : 0;
          throw new ConflictException({
            message: `Not enough tickets available for "${ticket.name}"`,
            available,
            requested: item.quantity,
          });
        }
      }

      if (coupon) {
        const couponUpdated = await tx.$executeRaw`
          UPDATE coupons
          SET usage_count = usage_count + 1
          WHERE id = ${coupon.id}
            AND (max_usages IS NULL OR usage_count + 1 <= max_usages)
        `;
        if (couponUpdated === 0) throw new ConflictException('Promo code usage limit reached');
      }

      return tx.order.create({
        data: {
          bookingId,
          userId,
          eventId: dto.eventId,
          subtotal,
          platformFee,
          taxAmount,
          totalAmount,
          discountAmount,
          couponId: coupon?.id ?? null,
          items: {
            create: dto.items.map((item) => {
              const ticket = ticketMap.get(item.ticketId)!;
              return {
                ticketId: item.ticketId,
                quantity: item.quantity,
                unitPrice: Number(ticket.price),
                attendees: {
                  create: [
                    { fullName: buyerName, email: buyerEmail, isLead: true, userId },
                    ...(item.groupAttendees ?? []).map((a) => ({
                      fullName: a.fullName,
                      email: a.email,
                      isLead: false,
                      userId: userIdByEmail.get(a.email) ?? null,
                    })),
                  ],
                },
              };
            }),
          },
        },
        include: {
          items: {
            include: {
              ticket: { select: { id: true, name: true, price: true } },
              attendees: true,
            },
          },
        },
      });
    });

    this.auditLogService.log({
      actorId: userId,
      actorRole: 'ATTENDEE',
      action: 'ORDER_CREATED',
      entityType: 'ORDER',
      entityId: order.id,
      metadata: { bookingId: order.bookingId, eventId: dto.eventId, totalAmount: order.totalAmount },
    });

    return order;
  }

  async mockConfirm(orderId: string, userId: string) {
    if (this.configService.get<string>('NODE_ENV') === 'production')
      throw new ForbiddenException('Mock confirm is not available in production');

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        userId: true,
        eventId: true,
        status: true,
        event: { select: { status: true } },
        items: {
          select: {
            ticket: { select: { name: true, saleStartDate: true, saleEndDate: true } },
          },
        },
      },
    });

    if (!order) throw new NotFoundException('Order not found');
    if (order.userId !== userId) throw new ForbiddenException('You do not own this order');
    if (order.status !== 'PENDING_PAYMENT')
      throw new BadRequestException(`Order is already ${order.status.toLowerCase().replace('_', ' ')}`);

    if (order.event.status !== 'PUBLISHED')
      throw new BadRequestException('This event is no longer available');

    const now = new Date();
    for (const item of order.items) {
      const { name, saleStartDate, saleEndDate } = item.ticket;
      if (saleStartDate && saleStartDate > now)
        throw new BadRequestException(`Ticket "${name}" sales have not started yet`);
      if (saleEndDate && saleEndDate < now)
        throw new BadRequestException(`Ticket "${name}" sales have ended`);
    }

    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'CONFIRMED', confirmedAt: new Date() },
    });

    this.auditLogService.log({
      actorId: userId,
      actorRole: 'ATTENDEE',
      action: 'ORDER_CONFIRMED',
      entityType: 'ORDER',
      entityId: orderId,
    });

    void this.notificationsService
      .create(userId, 'order_confirmed', 'Booking Confirmed!', 'Your tickets are confirmed. Open your order for QR codes.')
      .catch((err) => this.logger.error('Failed to send order_confirmed notification', err));

    void this.mailQueue
      .add('ticket-confirmation', { orderId })
      .catch((err) => this.logger.error('Failed to queue ticket-confirmation mail', err));

    void this.eventsVibeService.recomputeCrowdPulse(order.eventId);

    return { message: 'Order confirmed' };
  }

  async getMyOrders(userId: string, page = 1, limit = 20) {
    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where: { userId },
        select: {
          id: true,
          status: true,
          subtotal: true,
          platformFee: true,
          taxAmount: true,
          discountAmount: true,
          totalAmount: true,
          confirmedAt: true,
          cancelledAt: true,
          createdAt: true,
          event: {
            select: {
              id: true,
              title: true,
              eventDate: true,
              startTime: true,
              venueName: true,
              city: true,
            },
          },
          items: {
            select: {
              id: true,
              quantity: true,
              unitPrice: true,
              ticket: { select: { id: true, name: true } },
              _count: { select: { attendees: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.order.count({ where: { userId } }),
    ]);

    return { orders, total, page, limit };
  }

  async getOrderById(orderId: string, userId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            eventDate: true,
            startTime: true,
            endTime: true,
            venueName: true,
            fullAddress: true,
            city: true,
          },
        },
        coupon: { select: { code: true, discountType: true, discountValue: true } },
        items: {
          include: {
            ticket: { select: { id: true, name: true, description: true } },
            attendees: true,
          },
        },
      },
    });

    if (!order) throw new NotFoundException('Order not found');
    if (order.userId !== userId) throw new ForbiddenException('You do not own this order');

    return order;
  }

  async cancelOrder(orderId: string, userId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { select: { ticketId: true, quantity: true } },
        event: {
          select: {
            eventDate: true,
            refundPolicy: { select: { type: true, cutoffHours: true, refundPercent: true } },
          },
        },
      },
    });

    if (!order) throw new NotFoundException('Order not found');
    if (order.userId !== userId) throw new ForbiddenException('You do not own this order');
    if (order.status !== 'CONFIRMED')
      throw new BadRequestException('Only confirmed orders can be cancelled');

    const cutoffHours = order.event.refundPolicy?.cutoffHours ?? null;
    if (cutoffHours !== null && order.event.eventDate) {
      const cutoff = new Date(order.event.eventDate.getTime() - cutoffHours * 60 * 60 * 1000);
      if (new Date() > cutoff)
        throw new BadRequestException(
          `Cancellation window has passed (must cancel at least ${cutoffHours}h before the event)`,
        );
    }

    const policy = order.event.refundPolicy;
    let refundAmount = 0;
    if (policy) {
      if (policy.type === 'FULL') {
        refundAmount = Number(order.totalAmount);
      } else if (policy.type === 'PARTIAL' && policy.refundPercent) {
        refundAmount = Math.round(Number(order.totalAmount) * (policy.refundPercent / 100) * 100) / 100;
      }
      // NO_REFUND → refundAmount stays 0
    }

    await this.prisma.$transaction(async (tx) => {
      for (const item of order.items) {
        await tx.$executeRaw`
          UPDATE event_tickets
          SET "soldCount" = GREATEST("soldCount" - ${item.quantity}, 0)
          WHERE id = ${item.ticketId}
        `;
      }
      if (order.couponId) {
        await tx.$executeRaw`
          UPDATE coupons
          SET usage_count = GREATEST(usage_count - 1, 0)
          WHERE id = ${order.couponId}
        `;
      }
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: 'USER_CANCELLED' },
      });
    });

    this.auditLogService.log({
      actorId: userId,
      actorRole: 'ATTENDEE',
      action: 'ORDER_CANCELLED',
      entityType: 'ORDER',
      entityId: orderId,
      metadata: { reason: 'USER_CANCELLED', refundAmount },
    });

    void this.notificationsService
      .create(userId, 'order_cancelled', 'Booking Cancelled', 'Your order has been cancelled.')
      .catch((err) => this.logger.error('Failed to send order_cancelled notification', err));

    return { message: 'Order cancelled successfully', refundAmount };
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async expirePendingOrders() {
    const cutoff = new Date(Date.now() - PENDING_EXPIRY_MINUTES * 60 * 1000);
    const expired = await this.prisma.order.findMany({
      where: { status: 'PENDING_PAYMENT', createdAt: { lt: cutoff } },
      select: {
        id: true,
        couponId: true,
        items: { select: { ticketId: true, quantity: true } },
      },
    });

    for (const order of expired) {
      try {
        await this.prisma.$transaction(async (tx) => {
          for (const item of order.items) {
            await tx.$executeRaw`
              UPDATE event_tickets
              SET "soldCount" = GREATEST("soldCount" - ${item.quantity}, 0)
              WHERE id = ${item.ticketId}
            `;
          }
          if (order.couponId) {
            await tx.$executeRaw`
              UPDATE coupons
              SET usage_count = GREATEST(usage_count - 1, 0)
              WHERE id = ${order.couponId}
            `;
          }
          await tx.order.update({
            where: { id: order.id },
            data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: 'PAYMENT_TIMEOUT' },
          });
        });
      } catch (err) {
        this.logger.error(`Failed to expire order ${order.id}`, err);
      }
    }

    if (expired.length > 0) this.logger.log(`Expired ${expired.length} pending order(s)`);
  }
}
