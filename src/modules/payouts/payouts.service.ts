import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { createHmac } from 'crypto';
import { Decimal } from '@prisma/client/runtime/library';
import { PayoutMode, PayoutStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PayoutQueryDto } from './dto/payout-query.dto';
import { PayoutWebhookDto } from './dto/payout-webhook.dto';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Razorpay = require('razorpay');

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);
  private readonly razorpay: any;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly auditLogService: AuditLogService,
    private readonly notificationsService: NotificationsService,
    @InjectQueue('mail') private readonly mailQueue: Queue,
  ) {
    this.razorpay = new Razorpay({
      key_id: this.configService.get<string>('razorpay.keyId'),
      key_secret: this.configService.get<string>('razorpay.keySecret'),
    });
  }

  // ─── Eligibility check & payout creation ──────────────────────────────────

  async computeAndCreatePayout(eventId: string) {
    const holdDays = this.configService.get<number>('payout.holdDays');
    const tdsRate = this.configService.get<number>('payout.tdsRate');
    const minPayoutAmount = this.configService.get<number>('payout.minPayoutAmount');

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        title: true,
        eventDate: true,
        hostProfileId: true,
        hostProfile: {
          select: {
            id: true,
            payoutAccount: {
              select: {
                status: true,
                razorpayFundAccountId: true,
              },
            },
          },
        },
      },
    });

    if (!event) throw new NotFoundException(`Event ${eventId} not found`);

    if (!event.eventDate) {
      this.logger.warn(`Event ${eventId} has no eventDate — skipping payout computation`);
      return null;
    }

    const eventEnd = new Date(event.eventDate);
    const payoutEligibleAfter = new Date(eventEnd.getTime() + holdDays * 24 * 60 * 60 * 1000);

    if (new Date() < payoutEligibleAfter) {
      this.logger.log(`Event ${eventId} refund window not closed yet — eligible after ${payoutEligibleAfter.toISOString()}`);
      return null;
    }

    const payoutAccount = event.hostProfile?.payoutAccount;
    if (!payoutAccount || payoutAccount.status !== 'APPROVED') {
      this.logger.warn(`Event ${eventId}: host payout account not approved — skipping`);
      return null;
    }

    if (!payoutAccount.razorpayFundAccountId) {
      this.logger.warn(`Event ${eventId}: host has no razorpayFundAccountId — skipping`);
      return null;
    }

    // Idempotency: bail if payout already exists for this event+host
    const existing = await this.prisma.hostPayout.findUnique({
      where: { eventId_hostId: { eventId, hostId: event.hostProfile.id } },
    });
    if (existing) {
      this.logger.log(`Payout already exists for event ${eventId} — skipping`);
      return existing;
    }

    // Fetch all confirmed orders for this event that haven't been included in a payout yet
    const orders = await this.prisma.order.findMany({
      where: {
        eventId,
        status: 'CONFIRMED',
        payoutLineItem: null, // not yet paid out
      },
      select: {
        id: true,
        subtotal: true,
        discountAmount: true,
        platformFee: true,
      },
    });

    if (orders.length === 0) {
      this.logger.log(`Event ${eventId}: no unpaid confirmed orders — skipping`);
      return null;
    }

    // Aggregate financial totals
    let grossRevenue = new Decimal(0);
    let totalPlatformFee = new Decimal(0);

    for (const order of orders) {
      const netSubtotal = new Decimal(order.subtotal).minus(order.discountAmount);
      grossRevenue = grossRevenue.plus(netSubtotal);
      totalPlatformFee = totalPlatformFee.plus(order.platformFee);
    }

    const hostGross = grossRevenue.minus(totalPlatformFee);
    const tdsAmount = hostGross.times(tdsRate).toDecimalPlaces(2);
    const netPayoutAmount = hostGross.minus(tdsAmount).toDecimalPlaces(2);

    if (netPayoutAmount.lessThan(minPayoutAmount)) {
      this.logger.log(`Event ${eventId}: net payout ₹${netPayoutAmount} below minimum ₹${minPayoutAmount} — skipping`);
      return null;
    }

    // Create HostPayout + line items atomically
    const payout = await this.prisma.$transaction(async (tx) => {
      const created = await tx.hostPayout.create({
        data: {
          hostId: event.hostProfile.id,
          eventId,
          grossRevenue,
          platformFee: totalPlatformFee,
          hostGross,
          tdsAmount,
          netPayoutAmount,
          razorpayFundAccountId: payoutAccount.razorpayFundAccountId,
          status: 'PENDING',
          lineItems: {
            create: orders.map((order) => {
              const netSubtotal = new Decimal(order.subtotal).minus(order.discountAmount);
              const hostGrossForOrder = netSubtotal.minus(order.platformFee);
              return {
                orderId: order.id,
                hostGrossAmount: hostGrossForOrder,
                platformFee: order.platformFee,
                netAmount: hostGrossForOrder,
              };
            }),
          },
          history: {
            create: {
              toStatus: 'PENDING',
              actorType: 'SYSTEM',
              reason: 'Payout computed by batch job',
            },
          },
        },
      });

      return created;
    });

    this.auditLogService.log({
      action: 'PAYOUT_CREATED',
      entityType: 'PAYOUT',
      entityId: payout.id,
      actorRole: 'SYSTEM',
      metadata: { eventId, hostId: event.hostProfile.id, netPayoutAmount: netPayoutAmount.toNumber() },
    });

    this.logger.log(`Payout created: ${payout.id} for event ${eventId}, net ₹${netPayoutAmount}`);
    return payout;
  }

  // ─── Trigger payout via Razorpay Payouts API ──────────────────────────────

  async triggerPayout(payoutId: string) {
    const payout = await this.prisma.hostPayout.findUnique({
      where: { id: payoutId },
      include: { event: { select: { title: true } } },
    });

    if (!payout) throw new NotFoundException(`Payout ${payoutId} not found`);
    if (payout.status !== 'PENDING') {
      throw new BadRequestException(`Payout is ${payout.status} — only PENDING payouts can be triggered`);
    }

    const xAccountNumber = this.configService.get<string>('razorpay.xAccountNumber');
    if (!xAccountNumber) {
      this.logger.warn(`RAZORPAY_X_ACCOUNT_NUMBER not configured — skipping live trigger for payout ${payoutId}`);
      return payout;
    }

    const amountInPaise = Math.round(Number(payout.netPayoutAmount) * 100);

    const razorpayPayout = await this.razorpay.payouts.create({
      account_number: xAccountNumber,
      fund_account_id: payout.razorpayFundAccountId,
      amount: amountInPaise,
      currency: 'INR',
      mode: payout.payoutMode,
      purpose: 'payout',
      queue_if_low_balance: true,
      reference_id: payout.id, // idempotency key
      narration: `Meetday - ${payout.event?.title ?? 'event'} proceeds`,
    });

    const [updatedPayout] = await this.prisma.$transaction([
      this.prisma.hostPayout.update({
        where: { id: payoutId },
        data: {
          status: 'PROCESSING',
          razorpayPayoutId: razorpayPayout.id,
          initiatedAt: new Date(),
        },
      }),
      this.prisma.hostPayoutHistory.create({
        data: {
          payoutId,
          fromStatus: 'PENDING',
          toStatus: 'PROCESSING',
          actorType: 'SYSTEM',
          reason: `Razorpay payout ${razorpayPayout.id} initiated`,
        },
      }),
    ]);

    this.auditLogService.log({
      action: 'PAYOUT_TRIGGERED',
      entityType: 'PAYOUT',
      entityId: payoutId,
      actorRole: 'SYSTEM',
      metadata: { razorpayPayoutId: razorpayPayout.id, amountInPaise },
    });

    this.logger.log(`Payout ${payoutId} triggered — Razorpay payout ID: ${razorpayPayout.id}`);
    return updatedPayout;
  }

  // ─── Razorpay payout webhook handler ──────────────────────────────────────

  handlePayoutWebhook(rawBody: Buffer, signature: string, dto: PayoutWebhookDto) {
    this.verifyPayoutWebhookSignature(rawBody, signature);
    // Fire-and-forget; webhook must return 200 fast
    this.processPayoutWebhookEvent(dto).catch((err) =>
      this.logger.error(`Payout webhook processing failed: ${err.message}`, err.stack),
    );
  }

  private verifyPayoutWebhookSignature(rawBody: Buffer, signature: string): void {
    const secret = this.configService.get<string>('razorpay.payoutWebhookSecret');
    if (!secret) {
      this.logger.warn('RAZORPAY_PAYOUT_WEBHOOK_SECRET not set — skipping verification (dev mode)');
      return;
    }
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    if (expected !== signature) throw new UnauthorizedException('Invalid Razorpay payout webhook signature');
  }

  private async processPayoutWebhookEvent(dto: PayoutWebhookDto) {
    const entity = dto.payload?.payout?.entity;
    if (!entity) return;

    const razorpayPayoutId = entity.id;
    const referenceId = entity.reference_id; // our internal payoutId

    const payout = await this.prisma.hostPayout.findFirst({
      where: {
        OR: [
          { razorpayPayoutId },
          ...(referenceId ? [{ id: referenceId }] : []),
        ],
      },
    });

    if (!payout) {
      this.logger.warn(`Payout webhook: no matching payout for razorpayPayoutId=${razorpayPayoutId}`);
      return;
    }

    let newStatus: PayoutStatus;
    switch (dto.event) {
      case 'payout.processed':
        newStatus = 'COMPLETED';
        break;
      case 'payout.failed':
        newStatus = 'FAILED';
        break;
      case 'payout.reversed':
        newStatus = 'REVERSED';
        break;
      default:
        this.logger.log(`Payout webhook: unhandled event ${dto.event} — ignoring`);
        return;
    }

    await this.prisma.$transaction([
      this.prisma.hostPayout.update({
        where: { id: payout.id },
        data: {
          status: newStatus,
          statusReason: entity.failure_reason ?? null,
          completedAt: newStatus === 'COMPLETED' ? new Date() : undefined,
          failedAt: newStatus === 'FAILED' || newStatus === 'REVERSED' ? new Date() : undefined,
        },
      }),
      this.prisma.hostPayoutHistory.create({
        data: {
          payoutId: payout.id,
          fromStatus: payout.status,
          toStatus: newStatus,
          actorType: 'RAZORPAY_WEBHOOK',
          reason: entity.failure_reason ?? dto.event,
        },
      }),
    ]);

    const auditAction =
      newStatus === 'COMPLETED' ? 'PAYOUT_COMPLETED' : newStatus === 'REVERSED' ? 'PAYOUT_REVERSED' : 'PAYOUT_FAILED';

    this.auditLogService.log({
      action: auditAction,
      entityType: 'PAYOUT',
      entityId: payout.id,
      actorRole: 'SYSTEM',
      metadata: { razorpayPayoutId, event: dto.event, failureReason: entity.failure_reason },
    });

    if (newStatus === 'COMPLETED') {
      await this.notifyHostPayoutCompleted(payout.id);
    } else if (newStatus === 'FAILED') {
      this.logger.warn(`Payout ${payout.id} FAILED — reason: ${entity.failure_reason}`);
    }

    this.logger.log(`Payout ${payout.id} → ${newStatus} via webhook event ${dto.event}`);
  }

  private async notifyHostPayoutCompleted(payoutId: string) {
    const payout = await this.prisma.hostPayout.findUnique({
      where: { id: payoutId },
      include: {
        host: { include: { user: { select: { id: true, email: true, firstName: true } } } },
        event: { select: { title: true } },
      },
    });
    if (!payout) return;

    await this.notificationsService.create(
      payout.host.userId,
      'payout_completed',
      'Payout transferred!',
      `₹${payout.netPayoutAmount} for "${payout.event?.title ?? 'your event'}" has been sent to your bank account.`,
    );

    await this.mailQueue.add('payout-completed', {
      to: payout.host.user.email,
      firstName: payout.host.user.firstName,
      eventTitle: payout.event?.title,
      netPayoutAmount: payout.netPayoutAmount,
      payoutId: payout.id,
    });
  }

  // ─── Admin controls ────────────────────────────────────────────────────────

  async holdPayout(payoutId: string, reason: string, adminId: string) {
    const payout = await this.findPayoutOrThrow(payoutId);
    if (payout.status === 'COMPLETED' || payout.status === 'REVERSED') {
      throw new BadRequestException(`Cannot hold a ${payout.status} payout`);
    }

    await this.prisma.$transaction([
      this.prisma.hostPayout.update({
        where: { id: payoutId },
        data: { status: 'ON_HOLD', holdReason: reason },
      }),
      this.prisma.hostPayoutHistory.create({
        data: {
          payoutId,
          fromStatus: payout.status,
          toStatus: 'ON_HOLD',
          actorId: adminId,
          actorType: 'ADMIN',
          reason,
        },
      }),
    ]);

    this.auditLogService.log({
      action: 'PAYOUT_HELD',
      entityType: 'PAYOUT',
      entityId: payoutId,
      actorId: adminId,
      actorRole: 'ADMIN',
      metadata: { reason },
    });

    return { message: 'Payout placed on hold' };
  }

  async releasePayout(payoutId: string, adminId: string) {
    const payout = await this.findPayoutOrThrow(payoutId);
    if (payout.status !== 'ON_HOLD') {
      throw new BadRequestException(`Payout is not ON_HOLD (current: ${payout.status})`);
    }

    await this.prisma.$transaction([
      this.prisma.hostPayout.update({
        where: { id: payoutId },
        data: { status: 'PENDING', holdReason: null },
      }),
      this.prisma.hostPayoutHistory.create({
        data: {
          payoutId,
          fromStatus: 'ON_HOLD',
          toStatus: 'PENDING',
          actorId: adminId,
          actorType: 'ADMIN',
          reason: 'Hold released by admin',
        },
      }),
    ]);

    this.auditLogService.log({
      action: 'PAYOUT_RELEASED',
      entityType: 'PAYOUT',
      entityId: payoutId,
      actorId: adminId,
      actorRole: 'ADMIN',
    });

    return { message: 'Payout released — will be triggered on next batch run' };
  }

  async retryPayout(payoutId: string, adminId: string) {
    const payout = await this.findPayoutOrThrow(payoutId);
    if (payout.status !== 'FAILED') {
      throw new BadRequestException(`Only FAILED payouts can be retried (current: ${payout.status})`);
    }

    await this.prisma.$transaction([
      this.prisma.hostPayout.update({
        where: { id: payoutId },
        data: { status: 'PENDING', statusReason: null, razorpayPayoutId: null, initiatedAt: null, failedAt: null },
      }),
      this.prisma.hostPayoutHistory.create({
        data: {
          payoutId,
          fromStatus: 'FAILED',
          toStatus: 'PENDING',
          actorId: adminId,
          actorType: 'ADMIN',
          reason: 'Manual retry by admin',
        },
      }),
    ]);

    return this.triggerPayout(payoutId);
  }

  // ─── Host-facing queries ───────────────────────────────────────────────────

  async getHostPayouts(hostId: string, dto: PayoutQueryDto) {
    const { page = 1, limit = 20, status } = dto;
    const skip = (page - 1) * limit;

    const [payouts, total] = await Promise.all([
      this.prisma.hostPayout.findMany({
        where: { hostId, ...(status ? { status } : {}) },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          event: { select: { id: true, title: true, eventDate: true } },
          _count: { select: { lineItems: true } },
        },
      }),
      this.prisma.hostPayout.count({ where: { hostId, ...(status ? { status } : {}) } }),
    ]);

    return { data: payouts, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getHostPayoutById(payoutId: string, hostId: string) {
    const payout = await this.prisma.hostPayout.findUnique({
      where: { id: payoutId },
      include: {
        event: { select: { id: true, title: true, eventDate: true } },
        lineItems: {
          include: {
            order: { select: { id: true, bookingId: true, confirmedAt: true, totalAmount: true } },
          },
        },
        history: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!payout) throw new NotFoundException('Payout not found');
    if (payout.hostId !== hostId) throw new BadRequestException('Payout does not belong to your host profile');

    return payout;
  }

  async getHostEarnings(hostId: string) {
    const [completedAgg, pendingAgg, nextPayout] = await Promise.all([
      this.prisma.hostPayout.aggregate({
        where: { hostId, status: 'COMPLETED' },
        _sum: { netPayoutAmount: true, hostGross: true, tdsAmount: true },
        _count: true,
      }),
      this.prisma.hostPayout.aggregate({
        where: { hostId, status: { in: ['PENDING', 'PROCESSING'] } },
        _sum: { netPayoutAmount: true },
        _count: true,
      }),
      this.prisma.hostPayout.findFirst({
        where: { hostId, status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        include: { event: { select: { title: true, eventDate: true } } },
      }),
    ]);

    return {
      totalEarned: completedAgg._sum.netPayoutAmount ?? 0,
      totalTdsDeducted: completedAgg._sum.tdsAmount ?? 0,
      completedPayoutsCount: completedAgg._count,
      totalPending: pendingAgg._sum.netPayoutAmount ?? 0,
      pendingPayoutsCount: pendingAgg._count,
      nextPayout: nextPayout
        ? {
            id: nextPayout.id,
            netPayoutAmount: nextPayout.netPayoutAmount,
            event: nextPayout.event,
            createdAt: nextPayout.createdAt,
          }
        : null,
    };
  }

  async getHostEarningsByEvent(hostId: string) {
    const payouts = await this.prisma.hostPayout.findMany({
      where: { hostId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        grossRevenue: true,
        platformFee: true,
        hostGross: true,
        tdsAmount: true,
        netPayoutAmount: true,
        completedAt: true,
        event: { select: { id: true, title: true, eventDate: true } },
        _count: { select: { lineItems: true } },
      },
    });

    return payouts;
  }

  // ─── Admin queries ─────────────────────────────────────────────────────────

  async getAllPayouts(dto: PayoutQueryDto & { hostId?: string; eventId?: string }) {
    const { page = 1, limit = 20, status, hostId, eventId } = dto;
    const skip = (page - 1) * limit;

    const where = {
      ...(status ? { status } : {}),
      ...(hostId ? { hostId } : {}),
      ...(eventId ? { eventId } : {}),
    };

    const [payouts, total] = await Promise.all([
      this.prisma.hostPayout.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          host: { select: { id: true, displayName: true, legalName: true } },
          event: { select: { id: true, title: true, eventDate: true } },
          _count: { select: { lineItems: true } },
        },
      }),
      this.prisma.hostPayout.count({ where }),
    ]);

    return { data: payouts, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getPayoutLineItems(payoutId: string) {
    const payout = await this.findPayoutOrThrow(payoutId);
    return this.prisma.hostPayoutLineItem.findMany({
      where: { payoutId },
      include: {
        order: { select: { id: true, bookingId: true, confirmedAt: true, subtotal: true, discountAmount: true, platformFee: true, totalAmount: true } },
      },
    });
  }

  async getTdsSummary(financialYear: string) {
    // financialYear format: "2025-26" means Apr 2025 – Mar 2026
    const [startYear, endYearShort] = financialYear.split('-');
    if (!startYear || !endYearShort) throw new BadRequestException('Invalid financial year format. Use "YYYY-YY" e.g. "2025-26"');

    const fyStart = new Date(`${startYear}-04-01T00:00:00.000Z`);
    const fyEnd = new Date(`20${endYearShort}-03-31T23:59:59.999Z`);

    return this.prisma.hostPayout.groupBy({
      by: ['hostId'],
      where: {
        status: 'COMPLETED',
        completedAt: { gte: fyStart, lte: fyEnd },
        tdsAmount: { gt: 0 },
      },
      _sum: { tdsAmount: true, netPayoutAmount: true, hostGross: true },
      _count: true,
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async findPayoutOrThrow(payoutId: string) {
    const payout = await this.prisma.hostPayout.findUnique({ where: { id: payoutId } });
    if (!payout) throw new NotFoundException(`Payout ${payoutId} not found`);
    return payout;
  }
}
