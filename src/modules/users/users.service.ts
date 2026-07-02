import { BadRequestException, Injectable } from '@nestjs/common';
import * as firebaseAdmin from 'firebase-admin';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { DeleteAccountDto } from './dto/delete-account.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async deleteSelfAccount(
    userId: string,
    firebaseUid: string,
    role: string,
    dto: DeleteAccountDto,
    ip?: string,
    userAgent?: string,
  ): Promise<{ message: string }> {
    const blockers: string[] = [];

    // Block if the user has any confirmed orders for events that haven't started yet.
    // Under DPDP, the user must resolve active financial obligations before erasure.
    // (PENDING_PAYMENT orders expire automatically in 15 min — not a blocker.)
    const upcomingConfirmedOrder = await this.prisma.order.findFirst({
      where: {
        userId,
        status: 'CONFIRMED',
        event: { eventDate: { gte: new Date() } },
      },
      select: { id: true },
    });
    if (upcomingConfirmedOrder) {
      blockers.push(
        'You have confirmed bookings for upcoming events. Cancel your tickets first via the orders section.',
      );
    }

    if (role === 'HOST') {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { hostProfile: { select: { id: true } } },
      });

      const hostProfileId = user?.hostProfile?.id;
      if (hostProfileId) {
        // Block if the host has published events that haven't happened yet.
        const upcomingEvent = await this.prisma.event.findFirst({
          where: {
            hostProfileId,
            status: 'PUBLISHED',
            eventDate: { gte: new Date() },
          },
          select: { id: true },
        });
        if (upcomingEvent) {
          blockers.push(
            'You have upcoming published events. Cancel all active events before deleting your account.',
          );
        }

        // Block if there are outstanding payouts being processed (RBI compliance —
        // funds in transit cannot be abandoned mid-settlement).
        const pendingPayout = await this.prisma.hostPayout.findFirst({
          where: {
            hostId: hostProfileId,
            status: { in: ['PENDING', 'PROCESSING'] },
          },
          select: { id: true },
        });
        if (pendingPayout) {
          blockers.push(
            'You have payouts currently being processed. Wait for all pending payouts to settle before deleting your account.',
          );
        }
      }
    }

    if (blockers.length > 0) {
      throw new BadRequestException(blockers);
    }

    // Record that the data subject exercised their DPDP right to erasure.
    this.auditLogService.log({
      actorId: userId,
      actorRole: role,
      action: 'DATA_DELETION_REQUESTED',
      entityType: 'USER',
      entityId: userId,
      ipAddress: ip,
      userAgent,
      metadata: dto.reason ? { reason: dto.reason } : undefined,
    });

    // Soft-delete + PII anonymization (atomic).
    // Financial records (orders, payouts, refunds) are deliberately kept — required
    // by RBI/GST/IT Act for 8 years and PMLA for 5 years.
    // firebaseUid is kept to preserve the unique constraint so re-registration
    // with the same Firebase account is blocked while the record exists.
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          deletedAt: new Date(),
          isActive: false,
          firstName: '[Deleted]',
          lastName: '[User]',
          email: null,
          phone: null,
          avatarUrl: null,
        },
      }),
      this.prisma.consentRecord.updateMany({
        where: { userId, isActive: true },
        data: { isActive: false, withdrawnAt: new Date() },
      }),
    ]);

    // Disable the Firebase account so the token can no longer be used to
    // call any endpoint, even before the token naturally expires.
    await firebaseAdmin.auth().updateUser(firebaseUid, { disabled: true });

    this.auditLogService.log({
      actorId: userId,
      actorRole: role,
      action: 'USER_DELETED',
      entityType: 'USER',
      entityId: userId,
      ipAddress: ip,
      userAgent,
      metadata: dto.reason ? { reason: dto.reason } : undefined,
    });

    return {
      message:
        'Your account has been deleted and all personal data has been removed. Financial records are retained as required by applicable law.',
    };
  }
}
