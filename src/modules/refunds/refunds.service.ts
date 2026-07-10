import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { RefundReason } from '@prisma/client';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CancelTicketItemDto } from './dto/cancel-tickets.dto';

@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly auditLogService: AuditLogService,
    @InjectQueue('refund-processing') private readonly refundQueue: Queue,
  ) {}

  async initiateCancellation(
    orderId: string,
    items: CancelTicketItemDto[],
    reason: RefundReason,
    actorId: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            ticket: { select: { id: true, name: true, isFree: true } },
            attendees: { select: { id: true, fullName: true, checkedInAt: true, cancelledAt: true } },
          },
        },
        event: {
          select: {
            id: true,
            title: true,
            eventDate: true,
            cancellationReason: true,
            refundPolicy: { select: { type: true, cutoffHours: true, refundPercent: true } },
          },
        },
        user: { select: { id: true, email: true, firstName: true, phone: true } },
      },
    });

    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'CONFIRMED' && order.status !== 'PARTIALLY_REFUNDED')
      throw new BadRequestException('Only confirmed orders can have tickets cancelled');

    if (reason === 'USER_CANCELLED') {
      const cutoffHours = order.event.refundPolicy?.cutoffHours ?? null;
      if (cutoffHours !== null && order.event.eventDate) {
        const cutoff = new Date(order.event.eventDate.getTime() - cutoffHours * 60 * 60 * 1000);
        if (new Date() > cutoff)
          throw new BadRequestException(
            `Cancellation window has passed (must cancel at least ${cutoffHours}h before the event)`,
          );
      }
    }

    const orderItemMap = new Map(order.items.map((i) => [i.id, i]));

    // Validate all requested items and collect checked-in conflicts
    const checkedInConflicts: string[] = [];
    for (const reqItem of items) {
      const orderItem = orderItemMap.get(reqItem.orderItemId);
      if (!orderItem)
        throw new BadRequestException(`Order item ${reqItem.orderItemId} not found in this order`);

      const remainingQty = orderItem.quantity - orderItem.cancelledCount;
      if (reqItem.quantity > remainingQty)
        throw new BadRequestException(
          `Cannot cancel ${reqItem.quantity} ticket(s) for "${orderItem.ticket.name}": only ${remainingQty} active`,
        );

      if (reqItem.attendeeIds.length !== reqItem.quantity)
        throw new BadRequestException(
          `attendeeIds count must equal quantity for "${orderItem.ticket.name}"`,
        );

      for (const attendeeId of reqItem.attendeeIds) {
        const attendee = orderItem.attendees.find((a) => a.id === attendeeId);
        if (!attendee)
          throw new BadRequestException(`Attendee ${attendeeId} not found in order item`);
        if (attendee.cancelledAt)
          throw new BadRequestException(`Attendee "${attendee.fullName}"'s ticket is already cancelled`);
        if (attendee.checkedInAt)
          checkedInConflicts.push(`${attendee.fullName} (checked in at ${attendee.checkedInAt.toISOString()})`);
      }
    }

    if (checkedInConflicts.length > 0)
      throw new BadRequestException(
        `Cannot cancel tickets for attendees who have already checked in: ${checkedInConflicts.join(', ')}`,
      );

    // Compute total active tickets across the whole order
    const totalActiveTickets = order.items.reduce(
      (sum, item) => sum + item.quantity - item.cancelledCount,
      0,
    );
    const cancellingCount = items.reduce((sum, i) => sum + i.quantity, 0);
    const willBeFullyCancelled = cancellingCount === totalActiveTickets;

    // Determine refund policy multiplier
    const policy = order.event.refundPolicy;
    let refundMultiplier = 1;
    let platformFeeRefunded = false;

    if (reason === 'USER_CANCELLED') {
      if (!policy || policy.type === 'FULL') {
        refundMultiplier = 1;
      } else if (policy.type === 'PARTIAL' && policy.refundPercent) {
        refundMultiplier = policy.refundPercent / 100;
      } else if (policy.type === 'NO_REFUND') {
        refundMultiplier = 0;
      }
    } else {
      // EVENT_CANCELLED or ADMIN_OVERRIDE: full refund including platform fee
      platformFeeRefunded = true;
    }

    // Compute per-item refund amounts by prorating against the order subtotal
    const subtotal = Number(order.subtotal);
    const totalAmount = Number(order.totalAmount);
    const platformFee = Number(order.platformFee);
    const orderLevelRefundBase = reason === 'USER_CANCELLED' ? totalAmount - platformFee : totalAmount;

    const refundItemsData: Array<{
      orderItemId: string;
      quantity: number;
      unitAmount: number;
      attendeeIds: string[];
    }> = [];

    let totalRefundAmountPaise = 0;

    for (const reqItem of items) {
      const orderItem = orderItemMap.get(reqItem.orderItemId)!;
      const itemBase = Number(orderItem.unitPrice) * reqItem.quantity;
      const proportion = subtotal > 0 ? itemBase / subtotal : 0;
      const itemRefundRupees = orderLevelRefundBase * proportion * refundMultiplier;
      const itemRefundPaise = Math.round(itemRefundRupees * 100);
      const unitAmountPaise = reqItem.quantity > 0 ? Math.round(itemRefundPaise / reqItem.quantity) : 0;

      totalRefundAmountPaise += unitAmountPaise * reqItem.quantity;
      refundItemsData.push({
        orderItemId: reqItem.orderItemId,
        quantity: reqItem.quantity,
        unitAmount: unitAmountPaise,
        attendeeIds: reqItem.attendeeIds,
      });
    }

    const newOrderStatus = willBeFullyCancelled ? 'CANCELLED' : 'PARTIALLY_REFUNDED';

    // Atomic transaction: create refund record + update DB state
    const refund = await this.prisma.$transaction(async (tx) => {
      const refundRecord = await tx.refund.create({
        data: {
          orderId,
          status: 'PENDING',
          totalAmount: totalRefundAmountPaise,
          platformFeeRefunded,
          reason,
          items: {
            create: refundItemsData.map((ri) => ({
              orderItemId: ri.orderItemId,
              quantity: ri.quantity,
              unitAmount: ri.unitAmount,
            })),
          },
        },
      });

      for (const reqItem of items) {
        // Roll back capacity on the event ticket
        await tx.$executeRaw`
          UPDATE event_tickets
          SET "soldCount" = GREATEST("soldCount" - ${reqItem.quantity}, 0)
          WHERE id = (SELECT "ticketId" FROM order_items WHERE id = ${reqItem.orderItemId})
        `;
        // Track how many seats on this order item are now cancelled
        await tx.orderItem.update({
          where: { id: reqItem.orderItemId },
          data: { cancelledCount: { increment: reqItem.quantity } },
        });
        // Mark individual attendee slots as cancelled
        await tx.orderAttendee.updateMany({
          where: { id: { in: reqItem.attendeeIds } },
          data: { cancelledAt: new Date() },
        });
      }

      // Roll back coupon usage only on a full cancellation
      if (willBeFullyCancelled && order.couponId) {
        await tx.$executeRaw`
          UPDATE coupons SET usage_count = GREATEST(usage_count - 1, 0)
          WHERE id = ${order.couponId}
        `;
      }

      await tx.order.update({
        where: { id: orderId },
        data: {
          status: newOrderStatus,
          ...(willBeFullyCancelled
            ? { cancelledAt: new Date(), cancellationReason: reason }
            : {}),
        },
      });

      return refundRecord;
    });

    const actorRole =
      reason === 'USER_CANCELLED' ? 'ATTENDEE' : reason === 'EVENT_CANCELLED' ? 'HOST' : 'ADMIN';

    this.auditLogService.log({
      actorId,
      actorRole,
      action: 'REFUND_INITIATED',
      entityType: 'ORDER',
      entityId: orderId,
      metadata: { refundId: refund.id, totalAmount: totalRefundAmountPaise, reason, platformFeeRefunded },
    });

    const refundRupees = totalRefundAmountPaise / 100;
    const notifBody =
      refundRupees > 0
        ? `Your refund of ₹${refundRupees.toFixed(2)} is being processed (3–5 business days)`
        : 'Your cancellation has been processed.';

    void this.notificationsService
      .create(order.userId, 'refund_initiated', 'Refund Initiated', notifBody, {
        refundId: refund.id,
        orderId,
        amount: totalRefundAmountPaise,
      })
      .catch((err) => this.logger.error('Failed to send refund_initiated notification', err));

    await this.refundQueue.add(
      'process-refund',
      { refundId: refund.id },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );

    return refund;
  }
}
