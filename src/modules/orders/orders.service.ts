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
import { ValidateCouponDto } from './dto/validate-coupon.dto';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CommunityMembersService } from '../communities/community-members.service';
import { RedisService } from '../../common/redis/redis.service';
import { RefundsService } from '../refunds/refunds.service';
import { CancelTicketsDto } from '../refunds/dto/cancel-tickets.dto';
import { TicketPdfService } from './ticket-pdf.service';
import { Prisma } from '@prisma/client';

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
    private readonly communityMembersService: CommunityMembersService,
    private readonly redisService: RedisService,
    private readonly refundsService: RefundsService,
    private readonly ticketPdfService: TicketPdfService,
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
            id: true,
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
          minOrderValue: true,
          maxDiscountAmount: true,
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
    let paidSubtotal = 0;
    for (const item of dto.items) {
      const ticket = ticketMap.get(item.ticketId)!;
      const lineTotal = Number(ticket.price) * item.quantity;
      subtotal += lineTotal;
      if (!ticket.isFree) paidSubtotal += lineTotal;
    }

    let discountAmount = 0;
    if (coupon) {
      if (coupon.minOrderValue !== null && subtotal < coupon.minOrderValue)
        throw new BadRequestException(
          `A minimum order value of ₹${coupon.minOrderValue} is required to use this promo code`,
        );

      discountAmount =
        coupon.discountType === 'PERCENTAGE'
          ? subtotal * (coupon.discountValue / 100)
          : Math.min(coupon.discountValue, subtotal);

      if (coupon.maxDiscountAmount !== null)
        discountAmount = Math.min(discountAmount, coupon.maxDiscountAmount);

      discountAmount = Math.round(discountAmount * 100) / 100;
    }

    const netSubtotal = subtotal - discountAmount;
    // Platform fee only applies to paid ticket revenue
    const paidNetSubtotal = Math.max(0, paidSubtotal - discountAmount);

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

    const cachedGst = await this.redisService.get<number>('platform_config:gst_rate');
    let gstRate: number;
    if (cachedGst !== null) {
      gstRate = cachedGst;
    } else {
      const config = await this.prisma.platformConfig.findUnique({ where: { key: 'gst_rate' } });
      gstRate = config ? parseFloat(config.value) : 0.18;
      await this.redisService.set('platform_config:gst_rate', gstRate, 300);
    }

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
          SET "usageCount" = "usageCount" + 1
          WHERE id = ${coupon.id}
            AND ("maxUsages" IS NULL OR "usageCount" + 1 <= "maxUsages")
        `;
        if (couponUpdated === 0) throw new ConflictException('Promo code usage limit reached');

        // Re-check per-user limit inside the transaction. The UPDATE above acquires an
        // exclusive row lock on the coupon row, forcing concurrent transactions to serialize
        // here — so by this point any competing order from the same user is already committed
        // and visible to this count.
        if (coupon.maxUsagesPerUser) {
          const userUsage = await tx.order.count({
            where: { userId, couponId: coupon.id, status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] } },
          });
          if (userUsage >= coupon.maxUsagesPerUser)
            throw new ConflictException('You have already used this promo code the maximum number of times');
        }
      }

      // Resolve host fee promo and compute final financials (inside tx for atomicity)
      const promo = event.platformFeeWaived
        ? null
        : await this.resolveHostFeePromoInTx(tx, event.hostProfile.id, dto.eventId);

      let platformFee = Math.round(paidNetSubtotal * feeRate * 100) / 100;
      if (promo) {
        if (promo.discountType === 'PERCENTAGE') {
          platformFee = Math.round(platformFee * (1 - promo.discountValue / 100) * 100) / 100;
        } else {
          platformFee = Math.round(Math.max(0, platformFee - promo.discountValue) * 100) / 100;
        }
      }
      const taxAmount = Math.round((paidNetSubtotal + platformFee) * gstRate * 100) / 100;
      const totalAmount = Math.round((netSubtotal + platformFee + taxAmount) * 100) / 100;

      return tx.order.create({
        data: {
          bookingId,
          userId,
          eventId: dto.eventId,
          subtotal,
          discountAmount,
          netSubtotal,
          platformFee,
          taxAmount,
          totalAmount,
          couponId: coupon?.id ?? null,
          hostFeePromoId: promo?.id ?? null,
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

  async validateCoupon(userId: string, dto: ValidateCouponDto) {
    const now = new Date();

    const coupon = await this.prisma.coupon.findUnique({
      where: { code: dto.couponCode },
      select: {
        id: true,
        target: true,
        discountType: true,
        discountValue: true,
        minOrderValue: true,
        maxDiscountAmount: true,
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

    const ticketIds = dto.items.map((i) => i.ticketId);
    const tickets = await this.prisma.eventTicket.findMany({
      where: { id: { in: ticketIds }, eventId: dto.eventId },
      select: { id: true, price: true, isFree: true },
    });
    const ticketMap = new Map(tickets.map((t) => [t.id, t]));
    for (const item of dto.items) {
      if (!ticketMap.has(item.ticketId))
        throw new BadRequestException(`Ticket ${item.ticketId} not found for this event`);
    }

    let subtotal = 0;
    for (const item of dto.items) {
      subtotal += Number(ticketMap.get(item.ticketId)!.price) * item.quantity;
    }

    if (coupon.minOrderValue !== null && subtotal < coupon.minOrderValue)
      throw new BadRequestException(
        `A minimum order value of ₹${coupon.minOrderValue} is required to use this promo code`,
      );

    let discountAmount =
      coupon.discountType === 'PERCENTAGE'
        ? subtotal * (coupon.discountValue / 100)
        : Math.min(coupon.discountValue, subtotal);

    if (coupon.maxDiscountAmount !== null)
      discountAmount = Math.min(discountAmount, coupon.maxDiscountAmount);

    discountAmount = Math.round(discountAmount * 100) / 100;

    return {
      valid: true,
      couponCode: dto.couponCode,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      subtotal,
      discountAmount,
      netSubtotal: Math.round((subtotal - discountAmount) * 100) / 100,
    };
  }

  async confirmOrder(orderId: string, userId: string, razorpayPaymentId: string | null) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        userId: true,
        eventId: true,
        status: true,
        event: { select: { status: true, title: true, hostProfile: { select: { userId: true } } } },
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
      data: { status: 'CONFIRMED', confirmedAt: new Date(), razorpayPaymentId },
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

    if (order.event.hostProfile?.userId) {
      void this.notificationsService
        .create(
          order.event.hostProfile.userId,
          'event_new_booking',
          'New booking',
          `Someone booked a ticket for "${order.event.title}".`,
          { eventId: order.eventId, orderId },
        )
        .catch((err) => this.logger.error('Failed to send event_new_booking notification', err));
    }

    void this.mailQueue
      .add('ticket-confirmation', { orderId })
      .catch((err) => this.logger.error('Failed to queue ticket-confirmation mail', err));

    void this.eventsVibeService.recomputeCrowdPulse(order.eventId);

    void this.communityMembersService
      .recomputeForEvent(order.eventId, userId)
      .catch((err) => this.logger.error('Failed to recompute community member event count', err));

    return { message: 'Order confirmed' };
  }

  async mockConfirm(orderId: string, userId: string) {
    if (this.configService.get<string>('NODE_ENV') === 'production')
      throw new ForbiddenException('Mock confirm is not available in production');
    return this.confirmOrder(orderId, userId, 'mock');
  }

  async confirmFreeOrder(orderId: string, userId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, userId: true, totalAmount: true, status: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.userId !== userId) throw new ForbiddenException('You do not own this order');
    if (order.status !== 'PENDING_PAYMENT')
      throw new BadRequestException(`Order is already ${order.status.toLowerCase().replace('_', ' ')}`);
    if (Number(order.totalAmount) !== 0)
      throw new BadRequestException('This order requires payment — use POST /payments/initiate');
    return this.confirmOrder(orderId, userId, null);
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

  // Returns a presigned URL to download the ticket PDF. Only the buyer may
  // download, and only once the order holds valid tickets (confirmed, possibly
  // partially refunded). The PDF is lazily generated on first access if needed.
  async getTicketDownloadUrl(orderId: string, userId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { userId: true, status: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.userId !== userId) throw new ForbiddenException('You do not own this order');
    if (order.status !== 'CONFIRMED' && order.status !== 'PARTIALLY_REFUNDED') {
      throw new BadRequestException('Tickets are only available for confirmed orders');
    }

    const url = await this.ticketPdfService.getDownloadUrl(orderId);
    return { url };
  }

  async cancelTickets(orderId: string, userId: string, dto: CancelTicketsDto) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, userId: true, eventId: true, status: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.userId !== userId) throw new ForbiddenException('You do not own this order');
    if (order.status !== 'CONFIRMED' && order.status !== 'PARTIALLY_REFUNDED')
      throw new BadRequestException('Only confirmed orders can have tickets cancelled');

    const refund = await this.refundsService.initiateCancellation(orderId, dto.items, 'USER_CANCELLED', userId);

    void this.communityMembersService
      .recomputeForEvent(order.eventId, userId)
      .catch((err) => this.logger.error('Failed to recompute community member event count', err));

    return { message: 'Cancellation initiated', refundId: refund.id, refundAmountPaise: refund.totalAmount };
  }

  // Convenience: cancel every active ticket in the order in one call
  async cancelOrder(orderId: string, userId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            attendees: { where: { cancelledAt: null }, select: { id: true } },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.userId !== userId) throw new ForbiddenException('You do not own this order');
    if (order.status !== 'CONFIRMED' && order.status !== 'PARTIALLY_REFUNDED')
      throw new BadRequestException('Only confirmed orders can be cancelled');

    const items = order.items
      .map((item) => ({
        orderItemId: item.id,
        quantity: item.quantity - item.cancelledCount,
        attendeeIds: item.attendees.map((a) => a.id),
      }))
      .filter((i) => i.quantity > 0 && i.attendeeIds.length > 0);

    if (items.length === 0)
      throw new BadRequestException('No active tickets remaining on this order');

    return this.cancelTickets(orderId, userId, { items });
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
              SET "usageCount" = GREATEST("usageCount" - 1, 0)
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

  private async resolveHostFeePromoInTx(
    tx: Prisma.TransactionClient,
    hostProfileId: string,
    eventId: string,
  ): Promise<{ id: string; discountType: string; discountValue: number } | null> {
    const now = new Date();

    // Idempotent: if this event already has a promo usage, reuse the same promo
    const existingUsage = await tx.hostFeePromoUsage.findFirst({
      where: { eventId },
      select: { promo: { select: { id: true, discountType: true, discountValue: true } } },
    });
    if (existingUsage) return existingUsage.promo;

    // Find an active promo for this host
    const promo = await tx.hostFeePromo.findFirst({
      where: {
        hostProfileId,
        isActive: true,
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
          { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
        ],
      },
      select: { id: true, discountType: true, discountValue: true, maxEvents: true, eventsApplied: true },
    });

    if (!promo) return null;
    if (promo.maxEvents !== null && promo.eventsApplied >= promo.maxEvents) return null;

    await tx.hostFeePromoUsage.create({ data: { promoId: promo.id, eventId } });
    await tx.hostFeePromo.update({ where: { id: promo.id }, data: { eventsApplied: { increment: 1 } } });

    return promo;
  }
}
