import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { MailService } from '../../common/mail/mail.service';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Razorpay = require('razorpay');

@Processor('refund-processing')
export class RefundsProcessor {
  private readonly logger = new Logger(RefundsProcessor.name);
  private readonly razorpay: any;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly auditLogService: AuditLogService,
    private readonly mailService: MailService,
    configService: ConfigService,
  ) {
    this.razorpay = new Razorpay({
      key_id: configService.get<string>('razorpay.keyId'),
      key_secret: configService.get<string>('razorpay.keySecret'),
    });
  }

  @Process('process-refund')
  async handleRefund(job: Job<{ refundId: string }>) {
    const { refundId } = job.data;

    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
      include: {
        order: {
          select: {
            id: true,
            status: true,
            razorpayPaymentId: true,
            userId: true,
            event: { select: { id: true, title: true, cancellationReason: true } },
            user: { select: { id: true, email: true, firstName: true, phone: true } },
          },
        },
      },
    });

    if (!refund) throw new Error(`Refund ${refundId} not found`);
    if (refund.status !== 'PENDING') {
      this.logger.warn(`Refund ${refundId} already ${refund.status} — skipping`);
      return;
    }

    await this.prisma.refund.update({ where: { id: refundId }, data: { status: 'PROCESSING' } });

    try {
      const paymentId = refund.order.razorpayPaymentId;
      const isMockOrFree = !paymentId || paymentId === 'mock' || refund.totalAmount === 0;

      if (!isMockOrFree) {
        const rzpRefund = await this.razorpay.payments.refund(paymentId, {
          amount: refund.totalAmount,
          speed: 'optimum',
          notes: { refundId, orderId: refund.orderId },
        });

        await this.prisma.refund.update({
          where: { id: refundId },
          data: { razorpayRefundId: rzpRefund.id },
        });
      }

      await this.prisma.refund.update({
        where: { id: refundId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });

      // Transition fully-cancelled order to REFUNDED
      if (refund.order.status === 'CANCELLED') {
        await this.prisma.order.update({
          where: { id: refund.orderId },
          data: { status: 'REFUNDED' },
        });
      }

      const amountRupees = refund.totalAmount / 100;
      const eventTitle = refund.order.event.title ?? 'the event';
      const user = refund.order.user;

      if (user.email) {
        const isEventCancelled = refund.reason === 'EVENT_CANCELLED' || refund.reason === 'ADMIN_OVERRIDE';
        const mailPromise = isEventCancelled
          ? this.mailService.sendEventCancelledAttendee(
              user.email,
              user.firstName,
              eventTitle,
              refund.order.event.cancellationReason ?? 'Event cancelled by the host',
              amountRupees,
            )
          : amountRupees > 0
            ? this.mailService.sendRefundCompleted(user.email, user.firstName, amountRupees, eventTitle)
            : Promise.resolve();

        await mailPromise.catch((err) => this.logger.error('Failed to send post-refund mail', err));
      }

      void this.notificationsService
        .create(
          refund.order.userId,
          'refund_completed',
          'Refund Processed',
          amountRupees > 0
            ? `Your refund of ₹${amountRupees.toFixed(2)} has been sent to your original payment method.`
            : 'Your cancellation has been processed.',
          { refundId, orderId: refund.orderId },
        )
        .catch((err) => this.logger.error('Failed to send refund_completed notification', err));

      this.auditLogService.log({
        actorId: null,
        actorRole: 'SYSTEM',
        action: 'REFUND_COMPLETED',
        entityType: 'ORDER',
        entityId: refund.orderId,
        metadata: { refundId, razorpayRefundId: refund.razorpayRefundId, amount: refund.totalAmount },
      });

      this.logger.log(`Refund ${refundId} completed (₹${amountRupees.toFixed(2)})`);
    } catch (err: any) {
      const isLastAttempt = job.attemptsMade >= (job.opts.attempts ?? 1) - 1;
      this.logger.error(`Refund ${refundId} failed (attempt ${job.attemptsMade + 1})`, err);

      if (isLastAttempt) {
        const amountRupees = refund.totalAmount / 100;
        const user = refund.order.user;

        await this.prisma.refund.update({
          where: { id: refundId },
          data: { status: 'FAILED', failedAt: new Date(), failureReason: err?.message ?? 'Unknown error' },
        });

        if (user.email) {
          await this.mailService
            .sendRefundFailed(user.email, user.firstName, amountRupees)
            .catch((e) => this.logger.error('Failed to send refund_failed mail', e));
        }

        void this.notificationsService
          .create(
            refund.order.userId,
            'refund_failed',
            'Refund Failed',
            'We were unable to process your refund automatically. Our team has been notified and will reach out shortly.',
            { refundId, orderId: refund.orderId },
          )
          .catch((e) => this.logger.error('Failed to send refund_failed notification', e));

        // Notify all platform admins
        await this.notifyAdmins(refundId, refund.orderId, amountRupees, err?.message);

        this.auditLogService.log({
          actorId: null,
          actorRole: 'SYSTEM',
          action: 'REFUND_FAILED',
          entityType: 'ORDER',
          entityId: refund.orderId,
          metadata: { refundId, error: err?.message, amount: refund.totalAmount },
        });
      }

      throw err; // re-throw so Bull retries
    }
  }

  private async notifyAdmins(refundId: string, orderId: string, amountRupees: number, error: string) {
    try {
      const adminRole = await this.prisma.role.findUnique({
        where: { name: 'ADMIN' },
        select: { id: true },
      });
      if (!adminRole) return;

      const admins = await this.prisma.user.findMany({
        where: { roleId: adminRole.id, isActive: true, deletedAt: null },
        select: { id: true },
      });

      await Promise.allSettled(
        admins.map((admin) =>
          this.notificationsService.create(
            admin.id,
            'refund_failed_admin',
            'Refund Failed — Action Required',
            `Refund ${refundId} for order ${orderId} (₹${amountRupees.toFixed(2)}) failed after all retries. Error: ${error ?? 'unknown'}`,
            { refundId, orderId, amount: amountRupees },
          ),
        ),
      );
    } catch (e) {
      this.logger.error('Failed to notify admins of refund failure', e);
    }
  }
}
