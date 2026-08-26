import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import * as firebaseAdmin from 'firebase-admin';
import { PrismaService } from '../../prisma/prisma.service';
import { computeDealPaymentBreakdown, DEFAULT_SPONSORSHIP_GST_RATE } from '../../common/utils/sponsorship-deal-payment.util';
import { ListHostsQueryDto } from './dto/list-hosts-query.dto';
import { ListAdminsQueryDto } from './dto/list-admins-query.dto';
import { ListRolesQueryDto } from './dto/list-roles-query.dto';
import { RejectHostDto } from './dto/reject-host.dto';
import { SuspendHostDto } from './dto/suspend-host.dto';
import { RejectEventDto } from './dto/reject-event.dto';
import { ForceCancelEventDto } from './dto/force-cancel-event.dto';
import { InviteAdminDto } from './dto/invite-admin.dto';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';
import { ListCouponsQueryDto } from './dto/list-coupons-query.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CreateInterestDto } from './dto/create-interest.dto';
import { UpdateInterestDto } from './dto/update-interest.dto';
import { ListEventsQueryDto } from './dto/list-events-query.dto';
import { ListSponsorshipsQueryDto } from './dto/list-sponsorships-query.dto';
import { ListCampaignsQueryDto } from './dto/list-campaigns-query.dto';
import { ListCommunityProfilesQueryDto } from './dto/list-community-profiles-query.dto';
import { ListBrandsQueryDto, BrandProfileStatus } from './dto/list-brands-query.dto';
import { CreateAdminSponsorshipDto } from './dto/create-admin-sponsorship.dto';
import { UpdateAdminSponsorshipDto } from './dto/update-admin-sponsorship.dto';
import { ListEligibleHostsQueryDto } from './dto/list-eligible-hosts-query.dto';
import { CreateAdminCommunityProfileDto } from './dto/create-admin-community-profile.dto';
import { UpdateAdminCommunityProfileDto } from './dto/update-admin-community-profile.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { UpdateGstRateDto } from './dto/update-gst-rate.dto';
import { UpdatePlanFeeRateDto } from './dto/update-plan-fee-rate.dto';
import { CreateHostFeePromoDto } from './dto/create-host-fee-promo.dto';
import { UpdateHostFeePromoDto } from './dto/update-host-fee-promo.dto';
import { UpdateAdminProfileDto } from './dto/update-admin-profile.dto';
import { SendAnnouncementDto } from './dto/send-announcement.dto';
import { ListAnnouncementsQueryDto } from './dto/list-announcements-query.dto';
import { ListSponsorshipChatsQueryDto } from '../sponsorship/dto/list-sponsorship-chats-query.dto';
import { SendChatMessageDto } from '../sponsorship/dto/send-chat-message.dto';
import { RESOLVED_SYSTEM_MESSAGE } from '../meetday-chat/meetday-chat.service';
import { StorageService } from '../../common/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RedisService } from '../../common/redis/redis.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { InterestsService } from '../interests/interests.service';
import { RefundsService } from '../refunds/refunds.service';
import {
  applyEventChanges,
  classifyVenueChange,
  EventChanges,
  VenueMateriality,
} from '../events/event-changes.util';
import { APPROVED_EVENT_STATUSES } from '../events/event-time.util';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @InjectQueue('mail') private readonly mailQueue: Queue,
    private readonly storageService: StorageService,
    private readonly notificationsService: NotificationsService,
    private readonly redis: RedisService,
    private readonly auditLogService: AuditLogService,
    private readonly interestsService: InterestsService,
    private readonly refundsService: RefundsService,
  ) {}

  async listAdmins(query: ListAdminsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    // Include-list, not exclude-list — an exclude-list (e.g. just USER/HOST) silently
    // lets any other non-admin role (BRAND, etc.) leak into this list as new roles are added.
    const ADMIN_ROLES = ['SUPER_ADMIN', 'CITY_ADMIN', 'MODERATOR', 'SUPPORT'];

    const where: any = {
      role: { name: { in: ADMIN_ROLES } },
    };

    if (query.role) where.role = { name: query.role };
    if (query.isActive !== undefined) where.isActive = query.isActive;

    const [admins, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          isActive: true,
          createdAt: true,
          role: { select: { name: true } },
          adminProfile: { select: { managedCities: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { admins, total, page, limit };
  }

  async getRoles(query: ListRolesQueryDto) {
    const END_USER_ROLES = ['USER', 'HOST'];

    return this.prisma.role.findMany({
      where: query.adminOnly ? { name: { notIn: END_USER_ROLES } } : undefined,
      select: { id: true, name: true, description: true },
      orderBy: { name: 'asc' },
    });
  }

  async inviteAdmin(dto: InviteAdminDto) {
    // Look up the role
    const role = await this.prisma.role.findUnique({ where: { id: dto.roleId } });
    if (!role) {
      throw new BadRequestException('Invalid roleId');
    }
    if (role.name === 'CITY_ADMIN' && (!dto.managedCities || dto.managedCities.length === 0)) {
      throw new BadRequestException('managedCities is required for CITY_ADMIN');
    }

    // Check DB for existing user with this email — e.g. someone already registered as a HOST
    // or BRAND. Rather than rejecting, grant them admin access under the SAME login by setting
    // a secondary `adminRoleId` (their primary HOST/BRAND role is untouched).
    const existingInDb = await this.prisma.user.findFirst({
      where: { email: dto.email },
      select: { id: true, adminRoleId: true },
    });
    if (existingInDb) {
      if (existingInDb.adminRoleId) {
        throw new ConflictException(`A user with email ${dto.email} already has admin access`);
      }

      await this.prisma.user.update({
        where: { id: existingInDb.id },
        data: {
          adminRole: { connect: { id: role.id } },
          ...(role.name === 'CITY_ADMIN' && {
            adminProfile: { create: { managedCities: dto.managedCities } },
          }),
        },
      });

      void this.notificationsService
        .create(
          existingInDb.id,
          'admin_access_granted',
          'Admin access granted',
          `You've been granted ${role.name} access. Log in to the admin panel with your existing account to use it.`,
          {},
        )
        .catch((err) => this.logger.error('Failed to create admin_access_granted notification', err));

      return { message: 'Admin access granted to existing account' };
    }

    // Check Firebase for existing user
    try {
      await firebaseAdmin.auth().getUserByEmail(dto.email);
      throw new ConflictException(`A Firebase user with email ${dto.email} already exists`);
    } catch (error: any) {
      if (error?.errorInfo?.code !== 'auth/user-not-found') {
        throw error;
      }
      // auth/user-not-found — safe to proceed
    }

    // Generate a temp password that meets Firebase complexity requirements — never sent to invitee
    const tempPassword = crypto.randomBytes(16).toString('hex') + '!A1';

    // Create Firebase user
    const firebaseUser = await firebaseAdmin.auth().createUser({
      email: dto.email,
      password: tempPassword,
    });

    // Generate password reset link pointing to the frontend reset page
    const frontendUrl = this.configService.get<string>('frontendUrl');
    const resetLink = await firebaseAdmin.auth().generatePasswordResetLink(dto.email, {
      url: `${frontendUrl}/reset-password`,
    });

    // Create DB user — inactive until they complete profile
    await this.prisma.user.create({
      data: {
        firebaseUid: firebaseUser.uid,
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        isActive: false,
        mustCompleteProfile: true,
        role: { connect: { id: role.id } },
        ...(role.name === 'CITY_ADMIN' && {
          adminProfile: { create: { managedCities: dto.managedCities } },
        }),
      },
    });

    void this.mailQueue.add('admin-invite', {
      to: dto.email,
      roleName: role.name,
      resetLink,
    }).catch((err) => this.logger.error('Failed to queue admin-invite mail', err));

    return { message: 'Invitation sent' };
  }

  private readonly ownProfileSelect = {
    id: true,
    email: true,
    phone: true,
    firstName: true,
    lastName: true,
    avatarUrl: true,
    isActive: true,
    role: { select: { name: true } },
    createdAt: true,
    updatedAt: true,
  } as const;

  private async presignAvatar<T extends { avatarUrl: string | null }>(admin: T): Promise<T> {
    return {
      ...admin,
      avatarUrl: admin.avatarUrl
        ? await this.storageService.getPresignedDownloadUrl(admin.avatarUrl)
        : null,
    };
  }

  async getOwnProfile(userId: string) {
    const admin = await this.prisma.user.findUnique({
      where: { id: userId },
      select: this.ownProfileSelect,
    });

    if (!admin) {
      throw new NotFoundException('Admin not found');
    }

    return this.presignAvatar(admin);
  }

  async updateOwnProfile(userId: string, dto: UpdateAdminProfileDto) {
    const data: Prisma.UserUpdateInput = {};
    if (dto.avatarKey !== undefined) data.avatarUrl = dto.avatarKey;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;

    try {
      const admin = await this.prisma.user.update({
        where: { id: userId },
        data,
        select: this.ownProfileSelect,
      });
      return this.presignAvatar(admin);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2002') {
          throw new ConflictException('Phone number already in use');
        }
        if (err.code === 'P2025') {
          throw new NotFoundException('Admin not found');
        }
      }
      throw err;
    }
  }

  async listPendingHosts(query: ListHostsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where = { kycStatus: 'VERIFIED' as const, approvalStatus: 'PENDING' as const };

    const [hosts, total] = await Promise.all([
      this.prisma.hostProfile.findMany({
        where,
        include: {
          user: { select: { id: true, email: true, firstName: true, lastName: true, phone: true } },
          categories: { include: { category: true } },
        },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.hostProfile.count({ where }),
    ]);

    return { hosts, total, page, limit };
  }

  async listAllHosts(query: ListHostsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: any = {};
    if (query.approvalStatus) where.approvalStatus = query.approvalStatus;
    if (query.kycStatus) where.kycStatus = query.kycStatus;
    if (query.plan) where.currentPlan = query.plan;
    if (query.city) where.city = { contains: query.city, mode: 'insensitive' };
    if (query.search) {
      where.OR = [
        { displayName: { contains: query.search, mode: 'insensitive' } },
        { user: { email: { contains: query.search, mode: 'insensitive' } } },
        { user: { firstName: { contains: query.search, mode: 'insensitive' } } },
        { user: { lastName: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const [hosts, total] = await Promise.all([
      this.prisma.hostProfile.findMany({
        where,
        include: {
          user: { select: { id: true, email: true, firstName: true, lastName: true } },
          categories: { include: { category: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.hostProfile.count({ where }),
    ]);

    return { hosts, total, page, limit };
  }

  async getHostDetail(hostProfileId: string) {
    const host = await this.prisma.hostProfile.findUnique({
      where: { id: hostProfileId },
      include: {
        user: true,
        categories: { include: { category: true } },
        subscriptions: { orderBy: { createdAt: 'desc' }, take: 5 },
        payoutAccount: true,
      },
    });

    if (!host) throw new NotFoundException('Host not found');
    return host;
  }

  async approveHost(hostProfileId: string, adminId: string) {
    const host = await this.prisma.hostProfile.findUnique({
      where: { id: hostProfileId },
      include: { user: { select: { id: true, email: true, firstName: true } } },
    });

    if (!host) throw new NotFoundException('Host not found');
    if (host.kycStatus !== 'VERIFIED') {
      throw new BadRequestException('Host KYC must be verified before approval');
    }
    if (host.approvalStatus !== 'PENDING') {
      throw new BadRequestException('Host is not in a pending approval state');
    }

    await this.prisma.hostProfile.update({
      where: { id: hostProfileId },
      data: {
        approvalStatus: 'APPROVED',
        approvedAt: new Date(),
        approvedBy: adminId,
        currentPlan: 'DISCOVER',
      },
    });

    this.auditLogService.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: 'KYC_APPROVED',
      entityType: 'HOST',
      entityId: hostProfileId,
    });

    void this.mailQueue.add('host-approved', {
      to: host.user.email,
      hostName: host.user.firstName,
    }).catch((err) => this.logger.error('Failed to queue host-approved mail', err));
    void this.notificationsService.create(
      host.user.id,
      'host_approved',
      'Application Approved',
      "Your host application has been approved. You're now on the DISCOVER plan.",
    ).catch((err) => this.logger.error('Failed to create host_approved notification', err));

    return { message: 'Host approved successfully' };
  }

  async deactivateAdmin(targetAdminId: string, requestingAdminId: string) {
    if (targetAdminId === requestingAdminId) {
      throw new BadRequestException('You cannot deactivate your own account');
    }

    const END_USER_ROLES = ['USER', 'HOST'];

    const target = await this.prisma.user.findUnique({
      where: { id: targetAdminId },
      select: { id: true, firebaseUid: true, isActive: true, role: { select: { name: true } } },
    });

    if (!target) throw new NotFoundException('Admin user not found');

    if (END_USER_ROLES.includes(target.role.name)) {
      throw new BadRequestException('Target user is not an admin account');
    }

    if (target.role.name === 'SUPER_ADMIN') {
      throw new ForbiddenException('A SUPER_ADMIN account cannot be deactivated via this endpoint');
    }

    if (!target.isActive) {
      throw new BadRequestException('Admin account is already inactive');
    }

    await Promise.all([
      this.prisma.user.update({
        where: { id: targetAdminId },
        data: { isActive: false },
      }),
      firebaseAdmin.auth().updateUser(target.firebaseUid, { disabled: true }),
    ]);

    return { message: 'Admin account deactivated successfully' };
  }

  async reactivateAdmin(targetAdminId: string, requestingAdminId: string) {
    if (targetAdminId === requestingAdminId) {
      throw new BadRequestException('You cannot reactivate your own account via this endpoint');
    }

    const END_USER_ROLES = ['USER', 'HOST'];

    const target = await this.prisma.user.findUnique({
      where: { id: targetAdminId },
      select: { id: true, firebaseUid: true, isActive: true, role: { select: { name: true } } },
    });

    if (!target) throw new NotFoundException('Admin user not found');

    if (END_USER_ROLES.includes(target.role.name)) {
      throw new BadRequestException('Target user is not an admin account');
    }

    if (target.isActive) {
      throw new BadRequestException('Admin account is already active');
    }

    await Promise.all([
      this.prisma.user.update({
        where: { id: targetAdminId },
        data: { isActive: true },
      }),
      firebaseAdmin.auth().updateUser(target.firebaseUid, { disabled: false }),
    ]);

    return { message: 'Admin account reactivated successfully' };
  }

  async createCoupon(dto: CreateCouponDto, creatingAdminId: string) {
    const existing = await this.prisma.coupon.findUnique({ where: { code: dto.code } });
    if (existing) {
      throw new ConflictException(`Coupon code "${dto.code}" is already taken`);
    }

    if (dto.validFrom && dto.validUntil && new Date(dto.validFrom) >= new Date(dto.validUntil)) {
      throw new BadRequestException('validFrom must be before validUntil');
    }

    const coupon = await this.prisma.coupon.create({
      data: {
        code: dto.code,
        description: dto.description,
        target: dto.target,
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        maxUsages: dto.maxUsages,
        maxUsagesPerUser: dto.maxUsagesPerUser,
        minOrderValue: dto.minOrderValue ?? null,
        maxDiscountAmount: dto.maxDiscountAmount ?? null,
        isActive: true,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
        eventId: dto.eventId ?? null,
        createdBy: creatingAdminId,
      },
    });

    // Notify users who saved this event when an event-scoped attendee offer is created
    if (dto.target === 'ATTENDEE' && dto.eventId) {
      void this.notifySavedEventUsers(dto.eventId, coupon.code, dto.description);
    }

    return coupon;
  }

  private async notifySavedEventUsers(eventId: string, code: string, description?: string) {
    try {
      const event = await this.prisma.event.findUnique({
        where: { id: eventId },
        select: { title: true },
      });
      if (!event) return;

      const saved = await this.prisma.savedEvent.findMany({
        where: { eventId },
        select: { userId: true },
      });
      if (!saved.length) return;

      const body = description ?? `Use code ${code} to save on your ticket.`;

      await Promise.all(
        saved.map((s) =>
          this.notificationsService
            .create(s.userId, 'event_promo', `New offer for "${event.title}"`, body, { eventId, code })
            .catch((err) => this.logger.error(`Failed to notify user ${s.userId} of promo`, err)),
        ),
      );
    } catch (err) {
      this.logger.error('notifySavedEventUsers failed', err);
    }
  }

  async listCoupons(query: ListCouponsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: any = {};
    if (query.target !== undefined) where.target = query.target;
    if (query.isActive !== undefined) where.isActive = query.isActive;

    const [coupons, total] = await Promise.all([
      this.prisma.coupon.findMany({
        where,
        include: {
          _count: { select: { redemptions: true, orderUsages: true } },
          createdByUser: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.coupon.count({ where }),
    ]);

    return { coupons, total, page, limit };
  }

  async getCouponDetail(couponId: string) {
    const coupon = await this.prisma.coupon.findUnique({
      where: { id: couponId },
      include: {
        _count: { select: { redemptions: true, orderUsages: true } },
        createdByUser: { select: { id: true, firstName: true, lastName: true, email: true } },
        redemptions: {
          orderBy: { createdAt: 'desc' },
          include: {
            user: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        },
        orderUsages: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: {
            id: true,
            bookingId: true,
            status: true,
            subtotal: true,
            discountAmount: true,
            totalAmount: true,
            createdAt: true,
            user: { select: { id: true, firstName: true, lastName: true, email: true } },
            event: { select: { id: true, title: true } },
          },
        },
      },
    });

    if (!coupon) throw new NotFoundException('Coupon not found');
    return coupon;
  }

  async disableCoupon(couponId: string) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id: couponId } });
    if (!coupon) throw new NotFoundException('Coupon not found');
    if (!coupon.isActive) throw new BadRequestException('Coupon is already inactive');

    await this.prisma.coupon.update({ where: { id: couponId }, data: { isActive: false } });
    return { message: 'Coupon disabled successfully' };
  }

  async enableCoupon(couponId: string) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id: couponId } });
    if (!coupon) throw new NotFoundException('Coupon not found');
    if (coupon.isActive) throw new BadRequestException('Coupon is already active');

    await this.prisma.coupon.update({ where: { id: couponId }, data: { isActive: true } });
    return { message: 'Coupon enabled successfully' };
  }

  async updateCoupon(couponId: string, dto: UpdateCouponDto) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id: couponId } });
    if (!coupon) throw new NotFoundException('Coupon not found');

    if (dto.validFrom && dto.validUntil && new Date(dto.validFrom) >= new Date(dto.validUntil)) {
      throw new BadRequestException('validFrom must be before validUntil');
    }

    if (dto.maxUsages !== undefined && dto.maxUsages < coupon.usageCount) {
      throw new BadRequestException(
        `maxUsages cannot be set below the current usage count (${coupon.usageCount})`,
      );
    }

    return this.prisma.coupon.update({
      where: { id: couponId },
      data: {
        description: dto.description,
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        maxUsages: dto.maxUsages,
        maxUsagesPerUser: dto.maxUsagesPerUser,
        minOrderValue: dto.minOrderValue,
        maxDiscountAmount: dto.maxDiscountAmount,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
      },
    });
  }

  async rejectHost(hostProfileId: string, _adminId: string, dto: RejectHostDto) {
    const host = await this.prisma.hostProfile.findUnique({
      where: { id: hostProfileId },
      include: { user: { select: { id: true, email: true, firstName: true } } },
    });

    if (!host) throw new NotFoundException('Host not found');
    if (host.approvalStatus !== 'PENDING') {
      throw new BadRequestException('Host is not in a pending approval state');
    }

    await this.prisma.hostProfile.update({
      where: { id: hostProfileId },
      data: { approvalStatus: 'REJECTED', rejectionReason: dto.rejectionReason },
    });

    this.auditLogService.log({
      actorId: _adminId,
      actorRole: 'ADMIN',
      action: 'KYC_REJECTED',
      entityType: 'HOST',
      entityId: hostProfileId,
      metadata: { reason: dto.rejectionReason },
    });

    void this.mailQueue.add('host-rejected', {
      to: host.user.email,
      hostName: host.user.firstName,
      reason: dto.rejectionReason,
    }).catch((err) => this.logger.error('Failed to queue host-rejected mail', err));
    void this.notificationsService.create(
      host.user.id,
      'host_rejected',
      'Application Not Approved',
      `Your host application was not approved. Reason: ${dto.rejectionReason}`,
    ).catch((err) => this.logger.error('Failed to create host_rejected notification', err));

    return { message: 'Host rejected successfully' };
  }

  async suspendHost(hostProfileId: string, adminId: string, dto: SuspendHostDto) {
    const host = await this.prisma.hostProfile.findUnique({
      where: { id: hostProfileId },
      include: { user: { select: { id: true, email: true, firstName: true } } },
    });

    if (!host) throw new NotFoundException('Host not found');
    if (host.approvalStatus !== 'APPROVED')
      throw new BadRequestException('Only approved hosts can be suspended');

    await this.prisma.hostProfile.update({
      where: { id: hostProfileId },
      data: { approvalStatus: 'SUSPENDED', rejectionReason: dto.reason },
    });

    this.auditLogService.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: 'ADMIN_HOST_SUSPENDED',
      entityType: 'HOST',
      entityId: hostProfileId,
      metadata: { reason: dto.reason },
    });

    void this.mailQueue
      .add('host-suspended', {
        to: host.user.email,
        hostName: host.user.firstName,
        reason: dto.reason,
      })
      .catch((err) => this.logger.error('Failed to queue host-suspended mail', err));
    void this.notificationsService
      .create(
        host.user.id,
        'host_suspended',
        'Account Suspended',
        'Your host account has been suspended. Please contact support for details.',
      )
      .catch((err) => this.logger.error('Failed to create host_suspended notification', err));

    return { message: 'Host suspended successfully' };
  }

  async restoreHost(hostProfileId: string, adminId: string) {
    const host = await this.prisma.hostProfile.findUnique({
      where: { id: hostProfileId },
      include: { user: { select: { id: true, email: true, firstName: true } } },
    });

    if (!host) throw new NotFoundException('Host not found');
    if (host.approvalStatus !== 'SUSPENDED')
      throw new BadRequestException('Host is not currently suspended');

    await this.prisma.hostProfile.update({
      where: { id: hostProfileId },
      data: { approvalStatus: 'APPROVED', rejectionReason: null },
    });

    this.auditLogService.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: 'ADMIN_HOST_RESTORED',
      entityType: 'HOST',
      entityId: hostProfileId,
    });

    void this.mailQueue
      .add('host-restored', {
        to: host.user.email,
        hostName: host.user.firstName,
      })
      .catch((err) => this.logger.error('Failed to queue host-restored mail', err));
    void this.notificationsService
      .create(
        host.user.id,
        'host_restored',
        'Account Restored',
        'Your host account has been restored. You can now create and manage events.',
      )
      .catch((err) => this.logger.error('Failed to create host_restored notification', err));

    return { message: 'Host restored successfully' };
  }

  // ── Category management ──────────────────────────────────────────────────

  async createCategory(dto: CreateCategoryDto) {
    const existing = await this.prisma.category.findUnique({ where: { name: dto.name } });
    if (existing) throw new ConflictException(`Category "${dto.name}" already exists`);

    const category = await this.prisma.category.create({
      data: { name: dto.name, description: dto.description },
      select: { id: true, name: true, description: true, isActive: true, createdAt: true },
    });

    await this.redis.del('categories:public');
    return category;
  }

  async updateCategory(id: string, dto: UpdateCategoryDto) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Category not found');

    if (dto.name && dto.name !== category.name) {
      const conflict = await this.prisma.category.findUnique({ where: { name: dto.name } });
      if (conflict) throw new ConflictException(`Category "${dto.name}" already exists`);
    }

    const updated = await this.prisma.category.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      select: { id: true, name: true, description: true, isActive: true, updatedAt: true },
    });

    await this.redis.del('categories:public');
    return updated;
  }

  async listCategoriesPublic() {
    const CACHE_KEY = 'categories:public';
    const cached = await this.redis.get<{ id: string; name: string; description: string | null }[]>(CACHE_KEY);
    if (cached) return cached;

    const categories = await this.prisma.category.findMany({
      where: { isActive: true } as any,
      select: { id: true, name: true, description: true },
      orderBy: { name: 'asc' },
    });
    await this.redis.set(CACHE_KEY, categories, 3600);
    return categories;
  }

  async listCategoriesAdmin() {
    return this.prisma.category.findMany({
      select: { id: true, name: true, description: true, isActive: true, createdAt: true },
      orderBy: { name: 'asc' },
    });
  }

  // ── Event review ─────────────────────────────────────────────────────────

  async listPendingEvents(page: number, limit: number) {
    const where = { status: 'UNDER_REVIEW' as const };

    const [events, total] = await Promise.all([
      this.prisma.event.findMany({
        where,
        select: {
          id: true,
          title: true,
          eventType: true,
          eventDate: true,
          city: true,
          isFree: true,
          updatedAt: true,
          category: { select: { id: true, name: true } },
          hostProfile: {
            select: {
              id: true,
              displayName: true,
              user: { select: { id: true, firstName: true, lastName: true, email: true } },
            },
          },
          _count: { select: { tickets: true } },
        },
        orderBy: { updatedAt: 'asc' }, // oldest submission first (FIFO)
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.event.count({ where }),
    ]);

    return { events, total, page, limit };
  }

  async approveEvent(eventId: string, adminId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        hostProfile: {
          include: { user: { select: { id: true, email: true, firstName: true } } },
        },
      },
    });

    if (!event) throw new NotFoundException('Event not found');
    if (event.status !== 'UNDER_REVIEW')
      throw new BadRequestException('Only events in UNDER_REVIEW status can be approved');

    // Compare-and-set on status: if the host edited the event (recalling it to DRAFT) between our
    // read and here, this affects 0 rows and we abort — we never publish content that changed after
    // it was submitted for review.
    const { count } = await this.prisma.event.updateMany({
      where: { id: eventId, status: 'UNDER_REVIEW' },
      data: {
        status: 'PUBLISHED',
        reviewedBy: adminId,
        reviewedAt: new Date(),
      },
    });
    if (count === 0)
      throw new BadRequestException(
        'Event is no longer under review — it may have been edited and must be resubmitted',
      );

    await this.syncTotalEventsHosted(event.hostProfileId);

    const hostUser = event.hostProfile.user;
    const eventTitle = event.title ?? 'Untitled';

    this.auditLogService.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: 'EVENT_APPROVED',
      entityType: 'EVENT',
      entityId: eventId,
      metadata: { eventTitle },
    });

    void this.mailQueue.add('event-approved', {
      to: hostUser.email,
      hostName: hostUser.firstName,
      eventTitle,
    }).catch((err) => this.logger.error('Failed to queue event-approved mail', err));
    void this.notificationsService.create(
      hostUser.id,
      'event_approved',
      'Event Approved',
      `Your event "${eventTitle}" has been approved and is now live.`,
    ).catch((err) => this.logger.error('Failed to create event_approved notification', err));

    return { message: 'Event approved successfully' };
  }

  async listAllEvents(query: ListEventsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.city) where.city = { contains: query.city, mode: 'insensitive' };
    if (query.hostProfileId) where.hostProfileId = query.hostProfileId;
    if (query.categoryId) where.categoryId = query.categoryId;

    const [events, total] = await Promise.all([
      this.prisma.event.findMany({
        where,
        select: {
          id: true,
          title: true,
          status: true,
          eventType: true,
          eventDate: true,
          city: true,
          isFree: true,
          submittedAt: true,
          createdAt: true,
          category: { select: { id: true, name: true } },
          hostProfile: {
            select: {
              id: true,
              displayName: true,
              user: { select: { id: true, firstName: true, lastName: true, email: true } },
            },
          },
          _count: { select: { tickets: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.event.count({ where }),
    ]);

    return { events, total, page, limit };
  }

  async getEventDetail(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        tickets: true,
        refundPolicy: true,
        category: { select: { id: true, name: true } },
        hostProfile: {
          select: {
            id: true,
            displayName: true,
            user: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        },
        media: { orderBy: { order: 'asc' } },
      },
    });

    if (!event) throw new NotFoundException('Event not found');

    const signedMedia = await Promise.all(
      event.media.map(async (m) => ({ ...m, url: await this.storageService.getPresignedDownloadUrl(m.url) })),
    );
    return { ...event, media: signedMedia };
  }

  async rejectEvent(eventId: string, adminId: string, dto: RejectEventDto) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        hostProfile: {
          include: { user: { select: { id: true, email: true, firstName: true } } },
        },
      },
    });

    if (!event) throw new NotFoundException('Event not found');
    if (event.status !== 'UNDER_REVIEW')
      throw new BadRequestException('Only events in UNDER_REVIEW status can be rejected');

    // Compare-and-set on status: if the host recalled the event by editing it (now DRAFT) between
    // our read and here, this affects 0 rows and we abort rather than stamping a stale rejection.
    const { count } = await this.prisma.event.updateMany({
      where: { id: eventId, status: 'UNDER_REVIEW' },
      data: {
        status: 'DRAFT',
        adminRejectionRemark: dto.remark,
        reviewedBy: adminId,
        reviewedAt: new Date(),
      },
    });
    if (count === 0)
      throw new BadRequestException(
        'Event is no longer under review — it may have been edited and must be resubmitted',
      );

    const hostUser = event.hostProfile.user;
    const eventTitle = event.title ?? 'Untitled';

    this.auditLogService.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: 'EVENT_REJECTED',
      entityType: 'EVENT',
      entityId: eventId,
      metadata: { eventTitle, remark: dto.remark },
    });

    void this.mailQueue.add('event-rejected', {
      to: hostUser.email,
      hostName: hostUser.firstName,
      eventTitle,
      remark: dto.remark,
    }).catch((err) => this.logger.error('Failed to queue event-rejected mail', err));
    void this.notificationsService.create(
      hostUser.id,
      'event_rejected',
      'Event Not Approved',
      `Your event "${eventTitle}" was not approved. Remark: ${dto.remark}`,
    ).catch((err) => this.logger.error('Failed to create event_rejected notification', err));

    return { message: 'Event rejected successfully' };
  }

  // ── Event revisions (edits to already-published events) ────────────────────

  async listPendingRevisions(page: number, limit: number) {
    const where = { status: 'PENDING' as const };

    const [revisions, total] = await Promise.all([
      this.prisma.eventRevision.findMany({
        where,
        select: {
          id: true,
          eventId: true,
          touchesVenue: true,
          submittedBy: true,
          createdAt: true,
          updatedAt: true,
          event: {
            select: {
              id: true,
              title: true,
              city: true,
              status: true,
              eventDate: true,
              hostProfile: {
                select: {
                  id: true,
                  displayName: true,
                  user: { select: { id: true, firstName: true, lastName: true, email: true } },
                },
              },
            },
          },
        },
        // Venue-touching edits first, then oldest submission first (FIFO) — a last-minute venue
        // change should surface at the top of the review queue.
        orderBy: [{ touchesVenue: 'desc' }, { createdAt: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.eventRevision.count({ where }),
    ]);

    return { revisions, total, page, limit };
  }

  async getRevisionForReview(eventId: string) {
    const revision = await this.prisma.eventRevision.findFirst({
      where: { eventId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    if (!revision) throw new NotFoundException('No pending revision for this event');

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        media: { orderBy: { order: 'asc' } },
        category: { select: { id: true, name: true } },
        hostProfile: {
          select: {
            id: true,
            displayName: true,
            user: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        },
      },
    });
    if (!event) throw new NotFoundException('Event not found');

    const changes = revision.changes as unknown as EventChanges;

    // Current value of only the fields the revision touches, for a side-by-side review UI.
    const current: Record<string, unknown> = {};
    for (const key of Object.keys(changes)) {
      if (key === 'media') continue;
      current[key] = (event as unknown as Record<string, unknown>)[key];
    }

    const [currentMedia, proposedMedia] = await Promise.all([
      Promise.all(
        // Include the raw `key` so the diff view and any re-edit have the current items' keys.
        event.media.map(async (m) => ({ ...m, key: m.url, url: await this.storageService.getPresignedDownloadUrl(m.url) })),
      ),
      changes.media
        ? Promise.all(
            changes.media.map(async (m) => ({ ...m, url: await this.storageService.getPresignedDownloadUrl(m.key) })),
          )
        : Promise.resolve(undefined),
    ]);

    return {
      eventId,
      status: event.status,
      touchesVenue: revision.touchesVenue,
      hostProfile: event.hostProfile,
      current: { ...current, media: currentMedia },
      proposed: { ...changes, ...(proposedMedia ? { media: proposedMedia } : {}) },
      revision: {
        id: revision.id,
        status: revision.status,
        submittedBy: revision.submittedBy,
        createdAt: revision.createdAt,
        updatedAt: revision.updatedAt,
      },
    };
  }

  async approveRevision(eventId: string, adminId: string) {
    const revision = await this.prisma.eventRevision.findFirst({
      where: { eventId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    if (!revision) throw new NotFoundException('No pending revision for this event');

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        hostProfile: { include: { user: { select: { id: true, email: true, firstName: true } } } },
      },
    });
    if (!event) throw new NotFoundException('Event not found');
    if (event.status !== 'PUBLISHED')
      throw new BadRequestException('Revisions can only be applied to published events');

    const changes = revision.changes as unknown as EventChanges;
    // Classify against the CURRENT (pre-merge) event so the move is measured from the live venue.
    const materiality: VenueMateriality | null = revision.touchesVenue
      ? classifyVenueChange(event, changes)
      : null;

    await this.prisma.$transaction(async (tx) => {
      await applyEventChanges(tx, eventId, changes);
      await tx.eventRevision.update({
        where: { id: revision.id },
        data: { status: 'APPROVED', reviewedBy: adminId, reviewedAt: new Date() },
      });
    });

    const eventTitle = event.title ?? 'Untitled';

    this.auditLogService.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: 'EVENT_REVISION_APPROVED',
      entityType: 'EVENT',
      entityId: eventId,
      metadata: { revisionId: revision.id, touchesVenue: revision.touchesVenue, materiality },
    });

    void this.notificationsService
      .create(
        event.hostProfile.user.id,
        'event_changes_approved',
        'Your changes are live',
        `Your updates to "${eventTitle}" have been approved and are now live.`,
        { eventId },
      )
      .catch((err) => this.logger.error('Failed to create event_changes_approved notification', err));

    if (revision.touchesVenue && materiality)
      await this.fanOutVenueChangeNotice(eventId, eventTitle, changes, materiality);

    return { message: 'Revision approved and applied' };
  }

  async rejectRevision(eventId: string, adminId: string, dto: RejectEventDto) {
    const revision = await this.prisma.eventRevision.findFirst({
      where: { eventId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    if (!revision) throw new NotFoundException('No pending revision for this event');

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { title: true, hostProfile: { select: { user: { select: { id: true } } } } },
    });
    if (!event) throw new NotFoundException('Event not found');

    await this.prisma.eventRevision.update({
      where: { id: revision.id },
      data: { status: 'REJECTED', adminRemark: dto.remark, reviewedBy: adminId, reviewedAt: new Date() },
    });

    const eventTitle = event.title ?? 'Untitled';

    this.auditLogService.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: 'EVENT_REVISION_REJECTED',
      entityType: 'EVENT',
      entityId: eventId,
      metadata: { revisionId: revision.id, remark: dto.remark },
    });

    void this.notificationsService
      .create(
        event.hostProfile.user.id,
        'event_changes_rejected',
        'Changes not approved',
        `Your updates to "${eventTitle}" were not approved. Remark: ${dto.remark}`,
        { eventId },
      )
      .catch((err) => this.logger.error('Failed to create event_changes_rejected notification', err));

    return { message: 'Revision rejected' };
  }

  /**
   * Notifies confirmed attendees that a published event's venue moved. MINOR moves (same city,
   * ≤1km) get a soft in-app notice only; MAJOR moves (city change or >1km) also get an email so
   * nobody shows up at the old location. No auto-refund — attendees who can't make the new venue
   * use the standard refund policy (or an admin ADMIN_OVERRIDE for genuine hardship).
   */
  private async fanOutVenueChangeNotice(
    eventId: string,
    eventTitle: string,
    changes: EventChanges,
    materiality: VenueMateriality,
  ): Promise<void> {
    const orders = await this.prisma.order.findMany({
      where: { eventId, status: 'CONFIRMED' },
      select: { user: { select: { id: true, email: true, firstName: true } } },
    });

    const newVenue = changes.venueName ?? null;
    const newAddress = changes.fullAddress ?? null;
    const newCity = changes.city ?? null;
    const locationLabel = [newVenue, newAddress, newCity].filter(Boolean).join(', ');

    const seen = new Set<string>();
    for (const { user } of orders) {
      if (!user || seen.has(user.id)) continue;
      seen.add(user.id);

      void this.notificationsService
        .create(
          user.id,
          'event_venue_changed',
          'Venue updated',
          `The venue for "${eventTitle}" has changed${locationLabel ? ` — new location: ${locationLabel}` : ''}. Please check before you head out.`,
          { eventId, materiality },
        )
        .catch((err) => this.logger.error(`Failed to notify attendee ${user.id} of venue change`, err));

      if (materiality === 'MAJOR' && user.email) {
        void this.mailQueue
          .add('event-venue-changed', {
            to: user.email,
            firstName: user.firstName,
            eventTitle,
            venueName: newVenue,
            fullAddress: newAddress,
            city: newCity,
          })
          .catch((err) => this.logger.error('Failed to queue event-venue-changed mail', err));
      }
    }

    this.logger.log(
      `Venue change (${materiality}) on event ${eventId} fanned out to ${seen.size} attendee(s)`,
    );
  }

  async forceCancelEvent(eventId: string, adminId: string, dto: ForceCancelEventDto) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        hostProfile: {
          include: { user: { select: { id: true, email: true, firstName: true } } },
        },
      },
    });

    if (!event) throw new NotFoundException('Event not found');
    if (!['PUBLISHED', 'UNDER_REVIEW'].includes(event.status))
      throw new BadRequestException('Only PUBLISHED or UNDER_REVIEW events can be force-cancelled');

    const pendingOrders = await this.prisma.order.findMany({
      where: { eventId, status: 'PENDING_PAYMENT' },
      select: {
        id: true,
        couponId: true,
        items: { select: { ticketId: true, quantity: true } },
      },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.event.update({
        where: { id: eventId },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancellationReason: dto.reason,
        },
      });

      for (const order of pendingOrders) {
        for (const item of order.items) {
          await tx.$executeRaw`
            UPDATE event_tickets
            SET sold_count = GREATEST(sold_count - ${item.quantity}, 0)
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
      }

      if (pendingOrders.length > 0) {
        await tx.order.updateMany({
          where: { id: { in: pendingOrders.map((o) => o.id) } },
          data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: 'EVENT_CANCELLED' },
        });
      }
    });

    if (event.status === 'PUBLISHED') {
      await this.syncTotalEventsHosted(event.hostProfileId);
    }

    const hostUser = event.hostProfile.user;
    const eventTitle = event.title ?? 'Untitled';

    this.auditLogService.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: 'EVENT_CANCELLED',
      entityType: 'EVENT',
      entityId: eventId,
      metadata: { eventTitle, reason: dto.reason, pendingOrdersCancelled: pendingOrders.length },
    });

    void this.mailQueue
      .add('event-force-cancelled', {
        to: hostUser.email,
        hostName: hostUser.firstName,
        eventTitle,
        reason: dto.reason,
      })
      .catch((err) => this.logger.error('Failed to queue event-force-cancelled mail', err));
    void this.notificationsService
      .create(
        hostUser.id,
        'event_force_cancelled',
        'Event Cancelled by Admin',
        `Your event "${eventTitle}" has been cancelled by the platform team.`,
      )
      .catch((err) => this.logger.error('Failed to create event_force_cancelled notification', err));

    // Fan out refunds for all paid confirmed orders
    void this.fanOutEventCancellationRefunds(eventId, adminId);

    return {
      message: 'Event force-cancelled successfully',
      pendingOrdersCancelled: pendingOrders.length,
    };
  }

  private async syncTotalEventsHosted(hostProfileId: string): Promise<void> {
    const count = await this.prisma.event.count({
      // Count both so the tally stays stable when the completion cron flips PUBLISHED → COMPLETED.
      where: { hostProfileId, status: { in: APPROVED_EVENT_STATUSES } },
    });
    await this.prisma.hostProfile.update({
      where: { id: hostProfileId },
      data: { totalEventsHosted: count },
    });
  }

  private async fanOutEventCancellationRefunds(eventId: string, actorId: string) {
    const confirmedOrders = await this.prisma.order.findMany({
      where: { eventId, status: { in: ['CONFIRMED', 'PARTIALLY_REFUNDED'] } },
      include: {
        items: {
          include: { attendees: { where: { cancelledAt: null }, select: { id: true } } },
        },
      },
    });

    for (const order of confirmedOrders) {
      const items = order.items
        .map((item) => ({
          orderItemId: item.id,
          quantity: item.quantity - item.cancelledCount,
          attendeeIds: item.attendees.map((a) => a.id),
        }))
        .filter((i) => i.quantity > 0 && i.attendeeIds.length > 0);

      if (items.length === 0) continue;

      await this.refundsService
        .initiateCancellation(order.id, items, 'ADMIN_OVERRIDE', actorId)
        .catch((err) => this.logger.error(`Failed to initiate refund for order ${order.id}`, err));
    }

    if (confirmedOrders.length > 0)
      this.logger.log(`Initiated refunds for ${confirmedOrders.length} confirmed order(s) on event ${eventId}`);
  }

  // ─── Sponsorship proposal review ───────────────────────────────────────────────

  private static readonly SPONSORSHIP_LIST_SELECT = {
    id: true,
    name: true,
    city: true,
    eventDate: true,
    eventEndDate: true,
    venues: true,
    venueCities: true,
    status: true,
    submittedAt: true,
    createdAt: true,
    updatedAt: true,
    pendingRevision: true,
    hostProfile: {
      select: {
        id: true,
        displayName: true,
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    },
  } as const;

  async listPendingSponsorships(page: number, limit: number) {
    const where = { status: 'UNDER_REVIEW' as const };

    const [proposals, total] = await Promise.all([
      this.prisma.sponsorshipProposal.findMany({
        where,
        select: AdminService.SPONSORSHIP_LIST_SELECT,
        orderBy: { submittedAt: 'asc' }, // oldest submission first (FIFO)
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.sponsorshipProposal.count({ where }),
    ]);

    return { proposals, total, page, limit };
  }

  async listAllSponsorships(query: ListSponsorshipsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.city) where.city = { contains: query.city, mode: 'insensitive' };
    if (query.hostProfileId) where.hostProfileId = query.hostProfileId;

    const [proposals, total] = await Promise.all([
      this.prisma.sponsorshipProposal.findMany({
        where,
        select: AdminService.SPONSORSHIP_LIST_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.sponsorshipProposal.count({ where }),
    ]);

    return { proposals, total, page, limit };
  }

  async getSponsorshipDetail(id: string) {
    const proposal = await this.prisma.sponsorshipProposal.findUnique({
      where: { id },
      include: {
        hostProfile: {
          select: {
            id: true,
            displayName: true,
            user: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        },
        interests: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            createdAt: true,
            brandProfile: {
              select: {
                id: true,
                brandName: true,
                user: { select: { email: true, phone: true } },
              },
            },
          },
        },
      },
    });
    if (!proposal) throw new NotFoundException('Sponsorship proposal not found');

    const [imageUrl, docUrl] = await Promise.all([
      proposal.imageKey ? this.storageService.getPresignedDownloadUrl(proposal.imageKey) : null,
      proposal.docKey ? this.storageService.getPresignedDownloadUrl(proposal.docKey) : null,
    ]);

    let pendingRevision = proposal.pendingRevision as
      | (Record<string, unknown> & { imageKey?: string; docKey?: string })
      | null;
    if (pendingRevision) {
      // Only sign a URL for keys actually present in the diff — otherwise an unrelated field
      // edit (e.g. just the date) would overwrite the still-valid live image/doc URL with null.
      const [revImageUrl, revDocUrl] = await Promise.all([
        pendingRevision.imageKey ? this.storageService.getPresignedDownloadUrl(pendingRevision.imageKey) : undefined,
        pendingRevision.docKey ? this.storageService.getPresignedDownloadUrl(pendingRevision.docKey) : undefined,
      ]);
      pendingRevision = {
        ...pendingRevision,
        ...(revImageUrl !== undefined && { imageUrl: revImageUrl }),
        ...(revDocUrl !== undefined && { docUrl: revDocUrl }),
      };
    }

    return { ...proposal, imageUrl, docUrl, pendingRevision };
  }

  // ── Brands interested in sponsorships ("Brands" section for admins) ──

  async listSponsorshipInterests(page: number, limit: number) {
    const [interests, total] = await Promise.all([
      this.prisma.sponsorshipInterest.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          createdAt: true,
          brandProfile: {
            select: { id: true, brandName: true, user: { select: { email: true, phone: true } } },
          },
          sponsorshipProposal: {
            select: {
              id: true,
              name: true,
              hostProfile: { select: { displayName: true, user: { select: { firstName: true, lastName: true } } } },
            },
          },
        },
      }),
      this.prisma.sponsorshipInterest.count(),
    ]);

    return { interests, total, page, limit };
  }

  // Admin creates a sponsorship proposal directly, published immediately — no host KYC/approval
  // or review step involved. Attributed to a specific host if `dto.hostProfileId` is given
  // (e.g. creating it on behalf of a real host who asked the team to do it for them),
  // otherwise falls back to the "Meetday Official" system host.
  async createSponsorshipAsAdmin(adminId: string, dto: CreateAdminSponsorshipDto) {
    let hostProfileId: string;
    if (dto.hostProfileId) {
      const hostProfile = await this.prisma.hostProfile.findUnique({
        where: { id: dto.hostProfileId },
        select: { id: true },
      });
      if (!hostProfile) throw new NotFoundException('Host profile not found');
      hostProfileId = hostProfile.id;
    } else {
      hostProfileId = await this.storageService.getOrCreateOfficialHostProfileId();
    }

    const proposal = await this.prisma.sponsorshipProposal.create({
      data: {
        hostProfileId,
        name: dto.name,
        about: dto.about,
        imageKey: dto.imageKey,
        eventDate: new Date(dto.eventDate),
        eventEndDate: new Date(dto.eventEndDate),
        venue: dto.venues[0] ?? '',
        venues: dto.venues,
        city: dto.venueCities[0] ?? '',
        venueCities: dto.venueCities,
        audienceProfile: dto.audienceProfile,
        ageGroup: dto.ageGroup,
        guestCount: dto.guestCount,
        docKey: dto.docKey,
        docName: dto.docName,
        docType: dto.docType,
        docSize: dto.docSize,
        sponsorTiers: dto.sponsorTiers as unknown as Prisma.InputJsonValue,
        status: 'PUBLISHED',
        submittedAt: new Date(),
        reviewedBy: adminId,
        reviewedAt: new Date(),
      },
      include: {
        hostProfile: {
          select: {
            id: true,
            displayName: true,
            user: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        },
      },
    });

    this.auditLogService.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: 'SPONSORSHIP_PROPOSAL_CREATED_BY_ADMIN',
      entityType: 'SPONSORSHIP_PROPOSAL',
      entityId: proposal.id,
      metadata: { name: proposal.name },
    });

    const [imageUrl, docUrl] = await Promise.all([
      this.storageService.getPresignedDownloadUrl(proposal.imageKey),
      this.storageService.getPresignedDownloadUrl(proposal.docKey),
    ]);

    return { ...proposal, imageUrl, docUrl };
  }

  // Full admin edit of an existing proposal, any status — writes directly (no
  // pendingRevision staging), unlike the host-side edit flow which stages changes for
  // review once a proposal is UNDER_REVIEW or PUBLISHED.
  async updateSponsorshipAsAdmin(id: string, adminId: string, dto: UpdateAdminSponsorshipDto) {
    const existing = await this.prisma.sponsorshipProposal.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException('Sponsorship proposal not found');

    if (dto.hostProfileId) {
      const hostProfile = await this.prisma.hostProfile.findUnique({
        where: { id: dto.hostProfileId },
        select: { id: true },
      });
      if (!hostProfile) throw new NotFoundException('Host profile not found');
    }

    const proposal = await this.prisma.sponsorshipProposal.update({
      where: { id },
      data: {
        ...(dto.hostProfileId !== undefined && { hostProfileId: dto.hostProfileId }),
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.about !== undefined && { about: dto.about }),
        ...(dto.imageKey !== undefined && { imageKey: dto.imageKey }),
        ...(dto.eventDate !== undefined && { eventDate: new Date(dto.eventDate) }),
        ...(dto.eventEndDate !== undefined && { eventEndDate: new Date(dto.eventEndDate) }),
        ...(dto.venues !== undefined && { venues: dto.venues, venue: dto.venues[0] ?? '' }),
        ...(dto.venueCities !== undefined && { venueCities: dto.venueCities, city: dto.venueCities[0] ?? '' }),
        ...(dto.audienceProfile !== undefined && { audienceProfile: dto.audienceProfile }),
        ...(dto.ageGroup !== undefined && { ageGroup: dto.ageGroup }),
        ...(dto.guestCount !== undefined && { guestCount: dto.guestCount }),
        ...(dto.docKey !== undefined && { docKey: dto.docKey }),
        ...(dto.docName !== undefined && { docName: dto.docName }),
        ...(dto.docType !== undefined && { docType: dto.docType }),
        ...(dto.docSize !== undefined && { docSize: dto.docSize }),
        ...(dto.sponsorTiers !== undefined && { sponsorTiers: dto.sponsorTiers as unknown as Prisma.InputJsonValue }),
      },
      include: {
        hostProfile: {
          select: {
            id: true,
            displayName: true,
            user: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        },
      },
    });

    this.auditLogService.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: 'SPONSORSHIP_PROPOSAL_EDITED_BY_ADMIN',
      entityType: 'SPONSORSHIP_PROPOSAL',
      entityId: proposal.id,
      metadata: { name: proposal.name },
    });

    const [imageUrl, docUrl] = await Promise.all([
      this.storageService.getPresignedDownloadUrl(proposal.imageKey),
      this.storageService.getPresignedDownloadUrl(proposal.docKey),
    ]);

    return { ...proposal, imageUrl, docUrl };
  }

  async approveSponsorship(id: string, adminId: string) {
    const proposal = await this.prisma.sponsorshipProposal.findUnique({
      where: { id },
      include: { hostProfile: { include: { user: { select: { id: true, email: true, firstName: true } } } } },
    });
    if (!proposal) throw new NotFoundException('Sponsorship proposal not found');
    if (proposal.status !== 'UNDER_REVIEW')
      throw new BadRequestException('Only proposals in UNDER_REVIEW status can be approved');

    const { count } = await this.prisma.sponsorshipProposal.updateMany({
      where: { id, status: 'UNDER_REVIEW' },
      data: { status: 'PUBLISHED', reviewedBy: adminId, reviewedAt: new Date() },
    });
    if (count === 0)
      throw new BadRequestException('Proposal is no longer under review — it may have just been edited');

    const hostUser = proposal.hostProfile.user;

    this.auditLogService.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: 'SPONSORSHIP_PROPOSAL_APPROVED',
      entityType: 'SPONSORSHIP_PROPOSAL',
      entityId: id,
      metadata: { name: proposal.name },
    });

    void this.notificationsService
      .create(
        hostUser.id,
        'sponsorship_approved',
        'Sponsorship Proposal Approved',
        `Your proposal "${proposal.name}" has been approved and is now published.`,
        { proposalId: id },
      )
      .catch((err) => this.logger.error('Failed to create sponsorship_approved notification', err));

    return { message: 'Sponsorship proposal approved successfully' };
  }

  async rejectSponsorship(id: string, adminId: string, dto: RejectEventDto) {
    const proposal = await this.prisma.sponsorshipProposal.findUnique({
      where: { id },
      include: { hostProfile: { include: { user: { select: { id: true, email: true, firstName: true } } } } },
    });
    if (!proposal) throw new NotFoundException('Sponsorship proposal not found');
    if (proposal.status !== 'UNDER_REVIEW')
      throw new BadRequestException('Only proposals in UNDER_REVIEW status can be rejected');

    const { count } = await this.prisma.sponsorshipProposal.updateMany({
      where: { id, status: 'UNDER_REVIEW' },
      data: { status: 'REJECTED', adminRejectionRemark: dto.remark, reviewedBy: adminId, reviewedAt: new Date() },
    });
    if (count === 0)
      throw new BadRequestException('Proposal is no longer under review — it may have just been edited');

    const hostUser = proposal.hostProfile.user;

    this.auditLogService.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: 'SPONSORSHIP_PROPOSAL_REJECTED',
      entityType: 'SPONSORSHIP_PROPOSAL',
      entityId: id,
      metadata: { name: proposal.name, remark: dto.remark },
    });

    void this.notificationsService
      .create(
        hostUser.id,
        'sponsorship_rejected',
        'Sponsorship Proposal Not Approved',
        `Your proposal "${proposal.name}" was not approved. Remark: ${dto.remark}`,
        { proposalId: id },
      )
      .catch((err) => this.logger.error('Failed to create sponsorship_rejected notification', err));

    return { message: 'Sponsorship proposal rejected successfully' };
  }

  // ── Sponsorship proposal revisions (edits to UNDER_REVIEW/PUBLISHED proposals) ──

  async listPendingSponsorshipRevisions(page: number, limit: number) {
    const where = { pendingRevision: { not: Prisma.JsonNull } };

    const [proposals, total] = await Promise.all([
      this.prisma.sponsorshipProposal.findMany({
        where,
        select: AdminService.SPONSORSHIP_LIST_SELECT,
        orderBy: { updatedAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.sponsorshipProposal.count({ where }),
    ]);

    return { proposals, total, page, limit };
  }



  async approveSponsorshipRevision(id: string, adminId: string) {
    const proposal = await this.prisma.sponsorshipProposal.findUnique({
      where: { id },
      include: { hostProfile: { include: { user: { select: { id: true, email: true, firstName: true } } } } },
    });
    if (!proposal) throw new NotFoundException('Sponsorship proposal not found');
    if (!proposal.pendingRevision) throw new NotFoundException('No pending revision for this proposal');

    const changes = proposal.pendingRevision as Record<string, any>;

    await this.prisma.sponsorshipProposal.update({
      where: { id },
      data: {
        ...(changes.name !== undefined && { name: changes.name }),
        ...(changes.about !== undefined && { about: changes.about }),
        ...(changes.imageKey !== undefined && { imageKey: changes.imageKey }),
        ...(changes.eventDate !== undefined && { eventDate: new Date(changes.eventDate) }),
        ...(changes.eventEndDate !== undefined && {
          eventEndDate: changes.eventEndDate ? new Date(changes.eventEndDate) : null,
        }),
        ...(changes.venues !== undefined && {
          venues: changes.venues,
          venue: changes.venues[0] ?? '',
        }),
        ...(changes.venueCities !== undefined && {
          venueCities: changes.venueCities,
          city: changes.venueCities[0] ?? '',
        }),
        ...(changes.audienceProfile !== undefined && { audienceProfile: changes.audienceProfile }),
        ...(changes.ageGroup !== undefined && { ageGroup: changes.ageGroup }),
        ...(changes.guestCount !== undefined && { guestCount: changes.guestCount }),
        ...(changes.videoUrl !== undefined && { videoUrl: changes.videoUrl }),
        ...(changes.docKey !== undefined && { docKey: changes.docKey }),
        ...(changes.docName !== undefined && { docName: changes.docName }),
        ...(changes.docType !== undefined && { docType: changes.docType }),
        ...(changes.docSize !== undefined && { docSize: changes.docSize }),
        ...(changes.sponsorTiers !== undefined && { sponsorTiers: changes.sponsorTiers }),
        pendingRevision: Prisma.JsonNull,
        reviewedBy: adminId,
        reviewedAt: new Date(),
      },
    });

    this.auditLogService.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: 'SPONSORSHIP_PROPOSAL_REVISION_APPROVED',
      entityType: 'SPONSORSHIP_PROPOSAL',
      entityId: id,
    });

    void this.notificationsService
      .create(
        proposal.hostProfile.user.id,
        'sponsorship_changes_approved',
        'Your changes are live',
        `Your updates to "${proposal.name}" have been approved and are now live.`,
        { proposalId: id },
      )
      .catch((err) => this.logger.error('Failed to create sponsorship_changes_approved notification', err));

    return { message: 'Revision approved and applied' };
  }

  async rejectSponsorshipRevision(id: string, adminId: string, dto: RejectEventDto) {
    const proposal = await this.prisma.sponsorshipProposal.findUnique({
      where: { id },
      include: { hostProfile: { include: { user: { select: { id: true } } } } },
    });
    if (!proposal) throw new NotFoundException('Sponsorship proposal not found');
    if (!proposal.pendingRevision) throw new NotFoundException('No pending revision for this proposal');

    await this.prisma.sponsorshipProposal.update({
      where: { id },
      data: { pendingRevision: Prisma.JsonNull, reviewedBy: adminId, reviewedAt: new Date() },
    });

    this.auditLogService.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: 'SPONSORSHIP_PROPOSAL_REVISION_REJECTED',
      entityType: 'SPONSORSHIP_PROPOSAL',
      entityId: id,
      metadata: { remark: dto.remark },
    });

    void this.notificationsService
      .create(
        proposal.hostProfile.user.id,
        'sponsorship_changes_rejected',
        'Changes not approved',
        `Your updates to "${proposal.name}" were not approved. Remark: ${dto.remark}`,
        { proposalId: id },
      )
      .catch((err) => this.logger.error('Failed to create sponsorship_changes_rejected notification', err));

    return { message: 'Revision rejected' };
  }



  // ─── Host community profile review ─────────────────────────────────────────

  private static readonly COMMUNITY_PROFILE_SELECT = {
    id: true,
    name: true,
    about: true,
    logoKey: true,
    secondaryImageKey: true,
    size: true,
    avgGuestCount: true,
    experiencesPerYear: true,
    pastEvents: true,
    approvalStatus: true,
    adminRejectionRemark: true,
    reviewedAt: true,
    pendingRevision: true,
    isHidden: true,
    createdAt: true,
    updatedAt: true,
    categories: { select: { category: { select: { id: true, name: true } } } },
    hostProfile: {
      select: {
        id: true,
        displayName: true,
        operatingCities: true,
        socialLinks: true,
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    },
  } as const;

  async listPendingCommunityProfiles(page: number, limit: number) {
    const where = { approvalStatus: 'PENDING' as const };

    const [profiles, total] = await Promise.all([
      this.prisma.hostCommunityProfile.findMany({
        where,
        select: AdminService.COMMUNITY_PROFILE_SELECT,
        orderBy: { updatedAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.hostCommunityProfile.count({ where }),
    ]);

    return { profiles: profiles.map((p) => AdminService.flattenCommunityProfileCategories(p)), total, page, limit };
  }

  async listAllCommunityProfiles(query: ListCommunityProfilesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.HostCommunityProfileWhereInput = {};
    if (query.status) where.approvalStatus = query.status;

    const [profiles, total] = await Promise.all([
      this.prisma.hostCommunityProfile.findMany({
        where,
        select: AdminService.COMMUNITY_PROFILE_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.hostCommunityProfile.count({ where }),
    ]);

    return { profiles: profiles.map((p) => AdminService.flattenCommunityProfileCategories(p)), total, page, limit };
  }

  // All signed-up brands, split by profile completeness (name + categories + a social link).
  // Completeness isn't a stored column, so filtering/pagination happens in-memory after
  // computing it — acceptable at brand-signup volumes.
  async listBrands(query: ListBrandsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const profiles = await this.prisma.brandProfile.findMany({
      where: query.approvalStatus ? { approvalStatus: query.approvalStatus } : undefined,
      select: {
        id: true,
        brandName: true,
        socialLinks: true,
        workEmail: true,
        contactPhone: true,
        logoKey: true,
        companyType: true,
        aboutCompany: true,
        industry: true,
        approvalStatus: true,
        createdAt: true,
        user: { select: { id: true, email: true, phone: true, firstName: true, lastName: true } },
        categories: { select: { category: { select: { id: true, name: true } } } },
      },
      // The review queue (approvalStatus=PENDING) is FIFO — oldest submission first — matching
      // the Hosts/Sponsorships/Community Profile queues; the general brands list is newest-first.
      orderBy: { createdAt: query.approvalStatus === 'PENDING' ? 'asc' : 'desc' },
    });

    const withCompleteness = await Promise.all(
      profiles.map(async ({ categories, socialLinks, logoKey, ...rest }) => {
        const links = (socialLinks ?? {}) as Record<string, string | undefined>;
        const hasSocialLink = Object.values(links).some((v) => !!v);
        const brandCategories = categories.map((c) => c.category);
        const logoUrl = logoKey ? await this.storageService.getPresignedDownloadUrl(logoKey) : null;
        return {
          ...rest,
          socialLinks,
          logoKey,
          logoUrl,
          categories: brandCategories,
          isProfileComplete: !!rest.brandName && brandCategories.length > 0 && hasSocialLink,
        };
      }),
    );

    const filtered = query.profileStatus
      ? withCompleteness.filter((b) =>
          query.profileStatus === BrandProfileStatus.COMPLETE ? b.isProfileComplete : !b.isProfileComplete,
        )
      : withCompleteness;

    const total = filtered.length;
    const brands = filtered.slice((page - 1) * limit, (page - 1) * limit + limit);

    return { brands, total, page, limit };
  }

  // Mass-emails real brand/host accounts — queues one mail job per recipient rather than
  // sending inline so a bad Resend response for one recipient can't block/fail the rest.
  async sendAnnouncement(dto: SendAnnouncementDto, adminId: string) {
    const [brands, hosts] = await Promise.all([
      dto.allBrands || (dto.brandIds && dto.brandIds.length > 0)
        ? this.prisma.brandProfile.findMany({
            where: dto.allBrands ? undefined : { id: { in: dto.brandIds } },
            select: { user: { select: { email: true } } },
          })
        : Promise.resolve([]),
      dto.allCommunity || (dto.hostIds && dto.hostIds.length > 0)
        ? this.prisma.hostProfile.findMany({
            where: dto.allCommunity ? undefined : { id: { in: dto.hostIds } },
            select: { user: { select: { email: true } } },
          })
        : Promise.resolve([]),
    ]);

    const emails = Array.from(
      new Set([...brands.map((b) => b.user.email), ...hosts.map((h) => h.user.email)].filter(Boolean)),
    );
    if (emails.length === 0) throw new BadRequestException('No recipients matched');

    const subject = dto.subject?.trim() || 'An update from Meetday';
    for (const to of emails) {
      void this.mailQueue
        .add('announcement', { to, subject, message: dto.message })
        .catch((err) => this.logger.error('Failed to queue announcement mail', err));
    }

    const recipientsSummary =
      dto.recipientsSummary?.trim() ||
      [
        dto.allBrands ? 'All Brands' : dto.brandIds?.length ? `${dto.brandIds.length} Brand(s)` : null,
        dto.allCommunity ? 'All Community' : dto.hostIds?.length ? `${dto.hostIds.length} Host(s)` : null,
      ]
        .filter(Boolean)
        .join(', ');

    const record = await this.prisma.adminAnnouncement.create({
      data: {
        subject,
        message: dto.message,
        recipientCount: emails.length,
        recipientsSummary,
        sentById: adminId,
      },
    });

    this.auditLogService.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: 'ADMIN_ANNOUNCEMENT_SENT',
      entityType: 'ANNOUNCEMENT',
      entityId: record.id,
      metadata: { recipientCount: emails.length, subject, allBrands: !!dto.allBrands, allCommunity: !!dto.allCommunity },
    });

    return { queued: emails.length };
  }

  async listAnnouncements(query: ListAnnouncementsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const [announcements, total] = await Promise.all([
      this.prisma.adminAnnouncement.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { sentBy: { select: { firstName: true, lastName: true, email: true } } },
      }),
      this.prisma.adminAnnouncement.count(),
    ]);

    return { announcements, total, page, limit };
  }

  // ── TriChat: admin observes/participates in every Host ↔ Brand chat thread ─────

  async listSponsorshipChats(query: ListSponsorshipChatsQueryDto) {
    const threads = await this.prisma.sponsorshipInterest.findMany({
      where: {
        sponsorshipProposalId: { not: null },
        ...(query.status && { chatStatus: query.status }),
      },
      include: {
        sponsorshipProposal: {
          select: { id: true, name: true, hostProfile: { select: { displayName: true, communityProfile: { select: { name: true, logoKey: true } } } } },
        },
        brandProfile: { select: { id: true, brandName: true, logoKey: true } },
        chatMessages: { orderBy: { createdAt: 'desc' }, take: 1, select: { content: true, mediaKey: true, senderType: true, createdAt: true } },
        deal: { select: { id: true, status: true } },
      },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
    });

    // Unread = messages from the host or brand (not Meetday itself) sent after an admin last
    // opened this thread — shared across all admins, same as adminLastReadAt on the interest.
    const unreadCounts = await Promise.all(
      threads.map((t) =>
        this.prisma.sponsorshipChatMessage.count({
          where: {
            sponsorshipInterestId: t.id,
            senderType: { not: 'ADMIN' },
            deletedAt: null,
            ...(t.adminLastReadAt && { createdAt: { gt: t.adminLastReadAt } }),
          },
        }),
      ),
    );

    return Promise.all(
      threads.map(async (t, idx) => {
        const [brandLogoUrl, communityLogoUrl] = await Promise.all([
          t.brandProfile.logoKey ? this.storageService.getPresignedDownloadUrl(t.brandProfile.logoKey) : null,
          t.sponsorshipProposal.hostProfile.communityProfile?.logoKey
            ? this.storageService.getPresignedDownloadUrl(t.sponsorshipProposal.hostProfile.communityProfile.logoKey)
            : null,
        ]);
        return {
          id: t.id,
          proposalId: t.sponsorshipProposal.id,
          proposalName: t.sponsorshipProposal.name,
          communityName: t.sponsorshipProposal.hostProfile.communityProfile?.name ?? t.sponsorshipProposal.hostProfile.displayName ?? 'Community',
          brandName: t.brandProfile.brandName,
          chatStatus: t.chatStatus,
          createdAt: t.createdAt,
          chatAcceptedAt: t.chatAcceptedAt,
          lastMessageAt: t.lastMessageAt,
          lastMessagePreview: t.chatMessages[0] ? (t.chatMessages[0].content || (t.chatMessages[0].mediaKey ? '📷 Photo' : '')).slice(0, 120) : null,
          unreadCount: unreadCounts[idx],
          brandLogoUrl,
          communityLogoUrl,
          isDealLocked: t.deal?.status === 'APPROVED',
        };
      }),
    );
  }

  // Count of chats a brand has requested that the host hasn't accepted yet — backs the admin
  // sidebar's "Ongoing Chats" badge so pending requests aren't missed.
  async countPendingSponsorshipChats() {
    return this.prisma.sponsorshipInterest.count({
      where: {
        chatStatus: 'REQUESTED',
        sponsorshipProposalId: { not: null },
      },
    });
  }

  // Schedules the fallback "you have unread messages" email check — deduped by jobId so several
  // admin messages to the same recipient within the grace period collapse into one check/email.
  private scheduleUnreadChatEmail(interestId: string, recipientUserId: string) {
    const delayMinutes = this.configService.get<number>('unreadChatEmailDelayMinutes') ?? 10;
    void this.mailQueue
      .add(
        'unread-chat-message-check',
        { interestId, recipientUserId },
        {
          delay: delayMinutes * 60_000,
          jobId: `unread-chat:${interestId}:${recipientUserId}`,
          removeOnComplete: true,
          removeOnFail: true,
        },
      )
      .catch((err) => this.logger.error('Failed to schedule unread-chat-message-check job', err));
  }

  async getSponsorshipChatMessages(interestId: string) {
    const interest = await this.prisma.sponsorshipInterest.findUnique({ where: { id: interestId } });
    if (!interest) throw new NotFoundException('Chat thread not found');

    const messages = await this.prisma.sponsorshipChatMessage.findMany({
      where: { sponsorshipInterestId: interestId },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: {
        id: true,
        senderType: true,
        senderId: true,
        messageType: true,
        content: true,
        mediaKey: true,
        editedAt: true,
        deletedAt: true,
        createdAt: true,
        replyTo: { select: { id: true, senderType: true, content: true, mediaKey: true, deletedAt: true } },
      },
    });
    // Admin sees the original content even after a host/brand "deletes" it — deletedAt is
    // surfaced so the UI can flag it (e.g. "Deleted by sender"), not hidden like it is for them.
    const withMediaUrls = await Promise.all(
      messages.map(async ({ mediaKey, replyTo, ...m }) => ({
        ...m,
        mediaUrl: mediaKey ? await this.storageService.getPresignedDownloadUrl(mediaKey) : null,
        replyTo: replyTo
          ? { id: replyTo.id, senderType: replyTo.senderType, content: replyTo.deletedAt ? 'This message was deleted' : replyTo.content, hasMedia: !replyTo.deletedAt && !!replyTo.mediaKey }
          : null,
      })),
    );

    // Opening the thread marks everything up to now as read for admins (shared across all
    // admins) — drives the unread badge/count in listSponsorshipChats and the dashboard widget.
    void this.prisma.sponsorshipInterest
      .update({ where: { id: interestId }, data: { adminLastReadAt: new Date() } })
      .catch((err) => this.logger.error('Failed to update admin chat read state', err));

    return { messages: withMediaUrls, chatStatus: interest.chatStatus };
  }

  async sendSponsorshipChatMessage(interestId: string, adminId: string, dto: SendChatMessageDto) {
    const interest = await this.prisma.sponsorshipInterest.findUnique({
      where: { id: interestId },
      include: {
        sponsorshipProposal: { select: { hostProfile: { select: { userId: true } } } },
        brandProfile: { select: { userId: true } },
      },
    });
    if (!interest) throw new NotFoundException('Chat thread not found');
    if (!dto.content?.trim() && !dto.mediaKey) {
      throw new BadRequestException('Message must have text or an image');
    }

    let replyToRow: { id: string; senderType: string; content: string; mediaKey: string | null; deletedAt: Date | null } | null = null;
    if (dto.replyToId) {
      const original = await this.prisma.sponsorshipChatMessage.findUnique({
        where: { id: dto.replyToId },
        select: { id: true, senderType: true, content: true, mediaKey: true, deletedAt: true, sponsorshipInterestId: true },
      });
      if (!original || original.sponsorshipInterestId !== interestId) {
        throw new BadRequestException('You can only reply to a message in this chat');
      }
      replyToRow = original;
    }

    const message = await this.prisma.sponsorshipChatMessage.create({
      data: {
        sponsorshipInterestId: interestId,
        senderType: 'ADMIN',
        senderId: adminId,
        content: dto.content ?? '',
        mediaKey: dto.mediaKey,
        replyToId: dto.replyToId,
      },
    });
    await this.prisma.sponsorshipInterest.update({ where: { id: interestId }, data: { lastMessageAt: message.createdAt } });

    const preview = dto.content?.trim() ? dto.content.slice(0, 80) : '📷 Sent a photo';
    for (const to of [interest.sponsorshipProposal.hostProfile.userId, interest.brandProfile.userId]) {
      void this.notificationsService
        .create(to, 'sponsorship_chat_message', 'Meetday', preview, {
          sponsorshipInterestId: interestId,
        })
        .catch((err) => this.logger.error('Failed to notify of admin chat message', err));
      this.scheduleUnreadChatEmail(interestId, to);
    }

    const mediaUrl = dto.mediaKey ? await this.storageService.getPresignedDownloadUrl(dto.mediaKey) : null;
    return {
      ...message,
      mediaUrl,
      replyTo: replyToRow
        ? {
            id: replyToRow.id,
            senderType: replyToRow.senderType,
            content: replyToRow.deletedAt ? 'This message was deleted' : replyToRow.content,
            hasMedia: !replyToRow.deletedAt && !!replyToRow.mediaKey,
          }
        : null,
    };
  }

  // ── Deal Lock: admin oversight of negotiated & locked sponsorship deals ────────

  async listSponsorshipDeals(status?: 'PENDING_APPROVAL' | 'CHANGES_REQUESTED' | 'APPROVED') {
    const deals = await this.prisma.sponsorshipDeal.findMany({
      where: {
        ...(status && { status }),
        sponsorshipInterest: { sponsorshipProposalId: { not: null } },
      },
      include: {
        sponsorshipInterest: {
          select: {
            id: true,
            sponsorshipProposal: {
              select: { id: true, name: true, hostProfile: { select: { displayName: true, communityProfile: { select: { name: true } } } } },
            },
            brandProfile: { select: { id: true, brandName: true } },
          },
        },
        report: { select: { id: true } },
      },
      orderBy: [{ approvedAt: 'desc' }, { updatedAt: 'desc' }],
    });

    return Promise.all(
      deals.map(async (d) => {
        // Breakdown is only persisted once the brand initiates a Razorpay order — compute it
        // live for display before that, using the current gst_rate config (same as the brand side).
        let breakdown: { platformFeeAmount: Prisma.Decimal | number | null; transactionFeeAmount: Prisma.Decimal | number | null; taxAmount: Prisma.Decimal | number | null; totalAmount: Prisma.Decimal | number | null } = {
          platformFeeAmount: d.platformFeeAmount,
          transactionFeeAmount: d.transactionFeeAmount,
          taxAmount: d.taxAmount,
          totalAmount: d.totalAmount,
        };
        if (d.platformFeeAmount == null) {
          const gstConfig = await this.prisma.platformConfig.findUnique({ where: { key: 'gst_rate' } });
          const gstRate = gstConfig ? parseFloat(gstConfig.value) : DEFAULT_SPONSORSHIP_GST_RATE;
          breakdown = computeDealPaymentBreakdown(Number(d.sponsorshipAmount), gstRate);
        }

        return {
          id: d.id,
          sponsorshipInterestId: d.sponsorshipInterest.id,
          proposalId: d.sponsorshipInterest.sponsorshipProposal.id,
          proposalName: d.sponsorshipInterest.sponsorshipProposal.name,
          communityName:
            d.sponsorshipInterest.sponsorshipProposal.hostProfile.communityProfile?.name ??
            d.sponsorshipInterest.sponsorshipProposal.hostProfile.displayName ??
            'Community',
          brandName: d.sponsorshipInterest.brandProfile.brandName,
          projectName: d.projectName,
          startDate: d.startDate,
          endDate: d.endDate,
          time: d.time,
          sponsorshipCategory: d.sponsorshipCategory,
          sponsorshipAmount: d.sponsorshipAmount,
          venue: d.venue,
          barterElements: d.barterElements,
          deliverables: d.deliverables,
          otherTerms: d.otherTerms,
          additionalNotes: d.additionalNotes,
          status: d.status,
          version: d.version,
          changeRequestNote: d.changeRequestNote,
          approvedAt: d.approvedAt,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
          hasReport: !!d.report,
          paymentStatus: d.paymentStatus,
          ...breakdown,
          paymentExpiresAt: d.paymentExpiresAt,
          paidAt: d.paidAt,
          razorpayPaymentId: d.razorpayPaymentId,
          invoicePdfKey: d.invoicePdfKey,
        };
      }),
    );
  }

  // ── "Talk to Meetday" general support chat (separate from TriChat) ──────

  async listMeetdayChats() {
    const threads = await this.prisma.meetdayChatThread.findMany({
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            role: { select: { name: true } },
            hostProfile: { select: { communityProfile: { select: { logoKey: true } } } },
            brandProfile: { select: { logoKey: true } },
          },
        },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { content: true, mediaKey: true, createdAt: true } },
      },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
    });

    const unreadCounts = await Promise.all(
      threads.map((t) =>
        this.prisma.meetdayChatMessage.count({
          where: {
            threadId: t.id,
            senderType: 'USER',
            ...(t.adminLastReadAt && { createdAt: { gt: t.adminLastReadAt } }),
          },
        }),
      ),
    );

    return Promise.all(
      threads.map(async (t, idx) => {
        const logoKey = t.user.brandProfile?.logoKey || t.user.hostProfile?.communityProfile?.logoKey || null;
        return {
          id: t.id,
          userId: t.userId,
          userName: `${t.user.firstName} ${t.user.lastName}`.trim(),
          userEmail: t.user.email,
          userRole: t.user.role?.name ?? null,
          createdAt: t.createdAt,
          lastMessageAt: t.lastMessageAt,
          lastMessagePreview: t.messages[0] ? (t.messages[0].content || (t.messages[0].mediaKey ? '📷 Photo' : '')).slice(0, 120) : null,
          unreadCount: unreadCounts[idx],
          botDormant: t.botDormant,
          userLogoUrl: logoKey ? await this.storageService.getPresignedDownloadUrl(logoKey) : null,
        };
      }),
    );
  }

  async getMeetdayChatMessages(threadId: string) {
    const thread = await this.prisma.meetdayChatThread.findUnique({ where: { id: threadId } });
    if (!thread) throw new NotFoundException('Chat thread not found');

    const messages = await this.prisma.meetdayChatMessage.findMany({
      where: { threadId },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: { id: true, senderType: true, senderId: true, content: true, mediaKey: true, createdAt: true },
    });
    const withMediaUrls = await Promise.all(
      messages.map(async ({ mediaKey, ...m }) => ({
        ...m,
        mediaUrl: mediaKey ? await this.storageService.getPresignedDownloadUrl(mediaKey) : null,
      })),
    );

    void this.prisma.meetdayChatThread
      .update({ where: { id: threadId }, data: { adminLastReadAt: new Date() } })
      .catch((err) => this.logger.error('Failed to update Meetday chat admin read state', err));

    return { messages: withMediaUrls };
  }

  async sendMeetdayChatMessage(threadId: string, adminId: string, dto: SendChatMessageDto) {
    const thread = await this.prisma.meetdayChatThread.findUnique({ where: { id: threadId } });
    if (!thread) throw new NotFoundException('Chat thread not found');
    if (!dto.content?.trim() && !dto.mediaKey) {
      throw new BadRequestException('Message must have text or an image');
    }

    const message = await this.prisma.meetdayChatMessage.create({
      data: { threadId, senderType: 'ADMIN', senderId: adminId, content: dto.content ?? '', mediaKey: dto.mediaKey },
    });
    await this.prisma.meetdayChatThread.update({
      where: { id: threadId },
      // A human has taken over — stop the bot's auto-replies until this is marked resolved.
      data: { lastMessageAt: message.createdAt, adminLastReadAt: message.createdAt, botDormant: true },
    });

    const preview = dto.content?.trim() ? dto.content.slice(0, 80) : '📷 Sent a photo';
    void this.notificationsService
      .create(thread.userId, 'meetday_chat_message', 'Meetday', preview, { meetdayChatThreadId: threadId })
      .catch((err) => this.logger.error('Failed to notify of Meetday chat message', err));

    const mediaUrl = dto.mediaKey ? await this.storageService.getPresignedDownloadUrl(dto.mediaKey) : null;
    return { ...message, mediaUrl };
  }

  // Marks a Talk to Meetday thread resolved: posts a system message and resets the bot so it
  // resumes the scripted intake flow the next time the user writes in. No-op (doesn't post a
  // second system message) if the thread is already resolved/not dormant.
  async resolveMeetdayChat(threadId: string) {
    const thread = await this.prisma.meetdayChatThread.findUnique({ where: { id: threadId } });
    if (!thread) throw new NotFoundException('Chat thread not found');
    if (!thread.botDormant) return { alreadyResolved: true };

    const message = await this.prisma.meetdayChatMessage.create({
      data: { threadId, senderType: 'BOT', senderId: null, content: RESOLVED_SYSTEM_MESSAGE },
    });
    await this.prisma.meetdayChatThread.update({
      where: { id: threadId },
      data: { lastMessageAt: message.createdAt, botDormant: false },
    });

    return { ...message, mediaUrl: null };
  }

  // Total threads with an unread user message — backs the admin sidebar's "Meetday Chats" badge.
  async countUnreadMeetdayChats() {
    const threads = await this.prisma.meetdayChatThread.findMany({ select: { id: true, adminLastReadAt: true } });
    const unreadFlags = await Promise.all(
      threads.map((t) =>
        this.prisma.meetdayChatMessage.count({
          where: {
            threadId: t.id,
            senderType: 'USER',
            ...(t.adminLastReadAt && { createdAt: { gt: t.adminLastReadAt } }),
          },
        }),
      ),
    );
    return unreadFlags.filter((count) => count > 0).length;
  }


  async getCommunityProfileDetail(id: string) {
    const profile = await this.prisma.hostCommunityProfile.findUnique({
      where: { id },
      select: AdminService.COMMUNITY_PROFILE_SELECT,
    });
    if (!profile) throw new NotFoundException('Community profile not found');

    let pendingRevision = profile.pendingRevision as
      | (Record<string, unknown> & { logoKey?: string; secondaryImageKey?: string; pastEvents?: { name?: string; description?: string; imageKeys?: string[] }[] })
      | null;
    if (pendingRevision) {
      const [revisionLogoUrl, revisionSecondaryImageUrl, revisionPastEvents] = await Promise.all([
        pendingRevision.logoKey ? this.storageService.getPresignedDownloadUrl(pendingRevision.logoKey) : undefined,
        pendingRevision.secondaryImageKey
          ? this.storageService.getPresignedDownloadUrl(pendingRevision.secondaryImageKey)
          : undefined,
        this.withPastEventImageUrls(pendingRevision.pastEvents),
      ]);
      pendingRevision = {
        ...pendingRevision,
        logoUrl: revisionLogoUrl,
        secondaryImageUrl: revisionSecondaryImageUrl,
        pastEvents: revisionPastEvents,
      };
    }

    return {
      ...AdminService.flattenCommunityProfileCategories(profile),
      logoUrl: await this.storageService.getPresignedDownloadUrl(profile.logoKey),
      secondaryImageUrl: profile.secondaryImageKey ? await this.storageService.getPresignedDownloadUrl(profile.secondaryImageKey) : null,
      pastEvents: await this.withPastEventImageUrls(profile.pastEvents as { name?: string; description?: string; imageKeys?: string[] }[] | null),
      pendingRevision,
    };
  }

  // Signs each past event's image keys into downloadable URLs — pastEvents is stored as raw
  // JSON (array of { name?, description?, imageKeys? }), entirely optional at every level.
  private async withPastEventImageUrls(pastEvents: { name?: string; description?: string; imageKeys?: string[] }[] | null | undefined) {
    if (!pastEvents || !Array.isArray(pastEvents)) return [];
    return Promise.all(
      pastEvents.map(async (event) => ({
        name: event?.name ?? null,
        description: event?.description ?? null,
        imageKeys: event?.imageKeys ?? [],
        imageUrls: await Promise.all(
          (event?.imageKeys ?? []).map((key) => this.storageService.getPresignedDownloadUrl(key)),
        ),
      })),
    );
  }

  // Hosts eligible to have a community profile created for them by an admin — i.e. hosts that
  // don't already have one (HostProfile.communityProfile is null).
  async listHostsWithoutCommunityProfile(query: ListEligibleHostsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.HostProfileWhereInput = {
      communityProfile: null,
      ...(query.search && {
        OR: [
          { displayName: { contains: query.search, mode: 'insensitive' } },
          { user: { email: { contains: query.search, mode: 'insensitive' } } },
          { user: { firstName: { contains: query.search, mode: 'insensitive' } } },
          { user: { lastName: { contains: query.search, mode: 'insensitive' } } },
        ],
      }),
    };

    const [hosts, total] = await Promise.all([
      this.prisma.hostProfile.findMany({
        where,
        select: {
          id: true,
          displayName: true,
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.hostProfile.count({ where }),
    ]);

    return { hosts, total, page, limit };
  }

  // Admin creates a community profile already-approved for a host who doesn't have one yet,
  // bypassing the normal PENDING → review flow. Notifies the host once created.
  async createCommunityProfileAsAdmin(adminId: string, dto: CreateAdminCommunityProfileDto) {
    const hostProfile = await this.prisma.hostProfile.findUnique({
      where: { id: dto.hostProfileId },
      include: { communityProfile: { select: { id: true } }, user: { select: { id: true } } },
    });
    if (!hostProfile) throw new NotFoundException('Host profile not found');
    if (hostProfile.communityProfile) throw new ConflictException('This host already has a community profile');

    const validCategories = await this.prisma.category.findMany({
      where: { id: { in: dto.categoryIds } },
      select: { id: true },
    });
    if (validCategories.length !== dto.categoryIds.length) {
      throw new BadRequestException('One or more category IDs are invalid');
    }

    const communityProfile = await this.prisma.hostCommunityProfile.create({
      data: {
        hostProfileId: hostProfile.id,
        name: dto.name,
        about: dto.about,
        logoKey: dto.logoKey,
        secondaryImageKey: dto.secondaryImageKey,
        size: dto.size,
        avgGuestCount: dto.avgGuestCount,
        experiencesPerYear: dto.experiencesPerYear,
        approvalStatus: 'APPROVED',
        reviewedBy: adminId,
        reviewedAt: new Date(),
        categories: { create: dto.categoryIds.map((categoryId) => ({ categoryId })) },
        pastEvents: dto.pastEvents ? (JSON.parse(JSON.stringify(dto.pastEvents)) as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });

    // Guards against an empty/all-blank object wiping the host's existing social links.
    if (dto.socialLinks && Object.values(dto.socialLinks).some(Boolean)) {
      await this.prisma.hostProfile.update({
        where: { id: hostProfile.id },
        data: { socialLinks: JSON.parse(JSON.stringify(dto.socialLinks)) },
      });
    }

    this.auditLogService.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: 'COMMUNITY_PROFILE_APPROVED',
      entityType: 'HOST_COMMUNITY_PROFILE',
      entityId: communityProfile.id,
      metadata: { name: communityProfile.name, createdByAdmin: true },
    });

    void this.notificationsService
      .create(
        hostProfile.user.id,
        'community_profile_approved',
        'Community Profile Activated',
        `Your community profile "${communityProfile.name}" has been activated and is now visible to brands.`,
        { hostCommunityProfileId: communityProfile.id },
      )
      .catch((err) => this.logger.error('Failed to create community_profile_approved notification', err));

    return this.getCommunityProfileDetail(communityProfile.id);
  }

  // Full admin edit of an existing community profile, any approvalStatus — writes directly
  // (no pendingRevision staging), unlike the host-side edit flow which stages changes for
  // review once a profile is already APPROVED.
  async updateCommunityProfileAsAdmin(id: string, adminId: string, dto: UpdateAdminCommunityProfileDto) {
    const existing = await this.prisma.hostCommunityProfile.findUnique({
      where: { id },
      select: { id: true, hostProfileId: true },
    });
    if (!existing) throw new NotFoundException('Community profile not found');

    if (dto.categoryIds) {
      const validCategories = await this.prisma.category.findMany({
        where: { id: { in: dto.categoryIds } },
        select: { id: true },
      });
      if (validCategories.length !== dto.categoryIds.length) {
        throw new BadRequestException('One or more category IDs are invalid');
      }
    }

    await this.prisma.hostCommunityProfile.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.about !== undefined && { about: dto.about }),
        ...(dto.logoKey !== undefined && { logoKey: dto.logoKey }),
        ...(dto.secondaryImageKey !== undefined && { secondaryImageKey: dto.secondaryImageKey || null }),
        ...(dto.size !== undefined && { size: dto.size }),
        ...(dto.avgGuestCount !== undefined && { avgGuestCount: dto.avgGuestCount }),
        ...(dto.experiencesPerYear !== undefined && { experiencesPerYear: dto.experiencesPerYear }),
        ...(dto.categoryIds !== undefined && {
          categories: {
            deleteMany: {},
            create: dto.categoryIds.map((categoryId) => ({ categoryId })),
          },
        }),
        ...(dto.pastEvents !== undefined && {
          pastEvents: JSON.parse(JSON.stringify(dto.pastEvents)) as Prisma.InputJsonValue,
        }),
        ...(dto.isHidden !== undefined && { isHidden: dto.isHidden }),
      },
    });

    // Guards against an empty/all-blank object wiping the host's existing social links.
    if (dto.socialLinks && Object.values(dto.socialLinks).some(Boolean)) {
      await this.prisma.hostProfile.update({
        where: { id: existing.hostProfileId },
        data: { socialLinks: JSON.parse(JSON.stringify(dto.socialLinks)) },
      });
    }

    this.auditLogService.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: 'COMMUNITY_PROFILE_EDITED_BY_ADMIN',
      entityType: 'HOST_COMMUNITY_PROFILE',
      entityId: id,
      metadata: { name: dto.name },
    });

    return this.getCommunityProfileDetail(id);
  }

  // Quick one-click hide/unhide from the community profiles list — doesn't touch the host's own
  // access at all, only whether brands can discover this community and its proposals.
  async setCommunityProfileVisibility(id: string, adminId: string, isHidden: boolean) {
    const existing = await this.prisma.hostCommunityProfile.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!existing) throw new NotFoundException('Community profile not found');

    await this.prisma.hostCommunityProfile.update({ where: { id }, data: { isHidden } });

    this.auditLogService.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: isHidden ? 'COMMUNITY_PROFILE_HIDDEN' : 'COMMUNITY_PROFILE_UNHIDDEN',
      entityType: 'HOST_COMMUNITY_PROFILE',
      entityId: id,
      metadata: { name: existing.name },
    });

    return this.getCommunityProfileDetail(id);
  }

  // Prisma returns the categories relation nested as { category: { id, name } }[] — flatten it
  // to { id, name }[] to match what the frontend renders.
  private static flattenCommunityProfileCategories<
    T extends { categories: { category: { id: string; name: string } }[] },
  >(profile: T) {
    return { ...profile, categories: profile.categories.map((c) => c.category) };
  }

  async approveCommunityProfile(id: string, adminId: string) {
    const profile = await this.prisma.hostCommunityProfile.findUnique({
      where: { id },
      include: { hostProfile: { include: { user: { select: { id: true } } } } },
    });
    if (!profile) throw new NotFoundException('Community profile not found');
    if (profile.approvalStatus !== 'PENDING')
      throw new BadRequestException('Only profiles in PENDING status can be approved');

    await this.prisma.hostCommunityProfile.update({
      where: { id },
      data: { approvalStatus: 'APPROVED', reviewedBy: adminId, reviewedAt: new Date() },
    });

    this.auditLogService.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: 'COMMUNITY_PROFILE_APPROVED',
      entityType: 'HOST_COMMUNITY_PROFILE',
      entityId: id,
      metadata: { name: profile.name },
    });

    void this.notificationsService
      .create(
        profile.hostProfile.user.id,
        'community_profile_approved',
        'Community Profile Approved',
        `Your community profile "${profile.name}" has been approved and is now visible to brands.`,
        { hostCommunityProfileId: id },
      )
      .catch((err) => this.logger.error('Failed to create community_profile_approved notification', err));

    return { message: 'Community profile approved successfully' };
  }

  async rejectCommunityProfile(id: string, adminId: string, dto: RejectEventDto) {
    const profile = await this.prisma.hostCommunityProfile.findUnique({
      where: { id },
      include: { hostProfile: { include: { user: { select: { id: true } } } } },
    });
    if (!profile) throw new NotFoundException('Community profile not found');
    if (profile.approvalStatus !== 'PENDING')
      throw new BadRequestException('Only profiles in PENDING status can be rejected');

    await this.prisma.hostCommunityProfile.update({
      where: { id },
      data: { approvalStatus: 'REJECTED', adminRejectionRemark: dto.remark, reviewedBy: adminId, reviewedAt: new Date() },
    });

    this.auditLogService.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: 'COMMUNITY_PROFILE_REJECTED',
      entityType: 'HOST_COMMUNITY_PROFILE',
      entityId: id,
      metadata: { name: profile.name, remark: dto.remark },
    });

    void this.notificationsService
      .create(
        profile.hostProfile.user.id,
        'community_profile_rejected',
        'Community Profile Not Approved',
        `Your community profile "${profile.name}" was not approved. Remark: ${dto.remark}`,
        { hostCommunityProfileId: id },
      )
      .catch((err) => this.logger.error('Failed to create community_profile_rejected notification', err));

    return { message: 'Community profile rejected successfully' };
  }

  // ── Community profile revisions (edits to an already-APPROVED profile) ─────────

  async listPendingCommunityProfileRevisions(page: number, limit: number) {
    const where = { pendingRevision: { not: Prisma.JsonNull } };

    const [profiles, total] = await Promise.all([
      this.prisma.hostCommunityProfile.findMany({
        where,
        select: AdminService.COMMUNITY_PROFILE_SELECT,
        orderBy: { updatedAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.hostCommunityProfile.count({ where }),
    ]);

    return { profiles: profiles.map((p) => AdminService.flattenCommunityProfileCategories(p)), total, page, limit };
  }

  async approveCommunityProfileRevision(id: string, adminId: string) {
    const profile = await this.prisma.hostCommunityProfile.findUnique({
      where: { id },
      include: { hostProfile: { include: { user: { select: { id: true } } } } },
    });
    if (!profile) throw new NotFoundException('Community profile not found');
    if (!profile.pendingRevision) throw new NotFoundException('No pending revision for this profile');

    const changes = profile.pendingRevision as Record<string, any>;
    const { categoryIds, ...fieldChanges } = changes;

    await this.prisma.$transaction([
      this.prisma.hostCommunityProfile.update({
        where: { id },
        data: {
          ...(fieldChanges.name !== undefined && { name: fieldChanges.name }),
          ...(fieldChanges.about !== undefined && { about: fieldChanges.about }),
          ...(fieldChanges.logoKey !== undefined && { logoKey: fieldChanges.logoKey }),
          ...(fieldChanges.secondaryImageKey !== undefined && { secondaryImageKey: fieldChanges.secondaryImageKey }),
          ...(fieldChanges.size !== undefined && { size: fieldChanges.size }),
          ...(fieldChanges.avgGuestCount !== undefined && { avgGuestCount: fieldChanges.avgGuestCount }),
          ...(fieldChanges.experiencesPerYear !== undefined && { experiencesPerYear: fieldChanges.experiencesPerYear }),
          ...(fieldChanges.pastEvents !== undefined && {
            pastEvents: JSON.parse(JSON.stringify(fieldChanges.pastEvents)) as Prisma.InputJsonValue,
          }),
          pendingRevision: Prisma.JsonNull,
          reviewedBy: adminId,
          reviewedAt: new Date(),
        },
      }),
      ...(Array.isArray(categoryIds)
        ? [
            this.prisma.hostCommunityProfileCategory.deleteMany({ where: { hostCommunityProfileId: id } }),
            this.prisma.hostCommunityProfileCategory.createMany({
              data: (categoryIds as string[]).map((categoryId) => ({ hostCommunityProfileId: id, categoryId })),
            }),
          ]
        : []),
    ]);

    this.auditLogService.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: 'COMMUNITY_PROFILE_REVISION_APPROVED',
      entityType: 'HOST_COMMUNITY_PROFILE',
      entityId: id,
    });

    void this.notificationsService
      .create(
        profile.hostProfile.user.id,
        'community_profile_changes_approved',
        'Your changes are live',
        `Your updates to "${profile.name}" have been approved and are now live.`,
        { hostCommunityProfileId: id },
      )
      .catch((err) => this.logger.error('Failed to create community_profile_changes_approved notification', err));

    return { message: 'Revision approved and applied' };
  }

  async rejectCommunityProfileRevision(id: string, adminId: string, dto: RejectEventDto) {
    const profile = await this.prisma.hostCommunityProfile.findUnique({
      where: { id },
      include: { hostProfile: { include: { user: { select: { id: true } } } } },
    });
    if (!profile) throw new NotFoundException('Community profile not found');
    if (!profile.pendingRevision) throw new NotFoundException('No pending revision for this profile');

    await this.prisma.hostCommunityProfile.update({
      where: { id },
      data: { pendingRevision: Prisma.JsonNull, reviewedBy: adminId, reviewedAt: new Date() },
    });

    this.auditLogService.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: 'COMMUNITY_PROFILE_REVISION_REJECTED',
      entityType: 'HOST_COMMUNITY_PROFILE',
      entityId: id,
      metadata: { remark: dto.remark },
    });

    void this.notificationsService
      .create(
        profile.hostProfile.user.id,
        'community_profile_changes_rejected',
        'Changes not approved',
        `Your updates to "${profile.name}" were not approved. Remark: ${dto.remark}`,
        { hostCommunityProfileId: id },
      )
      .catch((err) => this.logger.error('Failed to create community_profile_changes_rejected notification', err));

    return { message: 'Revision rejected' };
  }

  async approveBrandProfile(id: string, adminId: string) {
    const profile = await this.prisma.brandProfile.findUnique({
      where: { id },
      include: { user: { select: { id: true } } },
    });
    if (!profile) throw new NotFoundException('Brand profile not found');
    if (profile.approvalStatus !== 'PENDING')
      throw new BadRequestException('Only profiles in PENDING status can be approved');

    await this.prisma.brandProfile.update({
      where: { id },
      data: { approvalStatus: 'APPROVED' },
    });

    this.auditLogService.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: 'BRAND_PROFILE_APPROVED',
      entityType: 'BRAND_PROFILE',
      entityId: id,
      metadata: { brandName: profile.brandName },
    });

    void this.notificationsService
      .create(
        profile.user.id,
        'brand_profile_approved',
        'Brand Profile Approved',
        `Your brand profile "${profile.brandName}" has been approved.`,
        { brandProfileId: id },
      )
      .catch((err) => this.logger.error('Failed to create brand_profile_approved notification', err));

    return { message: 'Brand profile approved successfully' };
  }

  async rejectBrandProfile(id: string, adminId: string, dto: RejectEventDto) {
    const profile = await this.prisma.brandProfile.findUnique({
      where: { id },
      include: { user: { select: { id: true } } },
    });
    if (!profile) throw new NotFoundException('Brand profile not found');
    if (profile.approvalStatus !== 'PENDING')
      throw new BadRequestException('Only profiles in PENDING status can be rejected');

    await this.prisma.brandProfile.update({
      where: { id },
      data: { approvalStatus: 'REJECTED' },
    });

    this.auditLogService.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: 'BRAND_PROFILE_REJECTED',
      entityType: 'BRAND_PROFILE',
      entityId: id,
      metadata: { brandName: profile.brandName, remark: dto.remark },
    });

    void this.notificationsService
      .create(
        profile.user.id,
        'brand_profile_rejected',
        'Brand Profile Not Approved',
        `Your brand profile "${profile.brandName}" was not approved. Remark: ${dto.remark}`,
        { brandProfileId: id },
      )
      .catch((err) => this.logger.error('Failed to create brand_profile_rejected notification', err));

    return { message: 'Brand profile rejected successfully' };
  }

  // ─── Order management ────────────────────────────────────────────────────────

  async listOrders(query: ListOrdersQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: any = {};
    if (query.eventId) where.eventId = query.eventId;
    if (query.userId) where.userId = query.userId;
    if (query.status) where.status = query.status;
    if (query.bookingId) where.bookingId = { contains: query.bookingId, mode: 'insensitive' };
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }
    if (query.hostProfileId) {
      where.event = { hostProfileId: query.hostProfileId };
    }

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        select: {
          id: true,
          bookingId: true,
          status: true,
          subtotal: true,
          discountAmount: true,
          platformFee: true,
          taxAmount: true,
          totalAmount: true,
          confirmedAt: true,
          cancelledAt: true,
          createdAt: true,
          user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
          event: {
            select: {
              id: true,
              title: true,
              eventDate: true,
              city: true,
              hostProfile: { select: { id: true, displayName: true } },
            },
          },
          coupon: { select: { code: true, discountType: true, discountValue: true } },
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
      this.prisma.order.count({ where }),
    ]);

    return { orders, total, page, limit };
  }

  async getOrderDetail(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
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
            hostProfile: { select: { id: true, displayName: true, userId: true } },
          },
        },
        coupon: { select: { code: true, discountType: true, discountValue: true } },
        items: {
          include: {
            ticket: { select: { id: true, name: true, description: true, price: true } },
            attendees: true,
          },
        },
      },
    });

    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  // ─── Interests ───────────────────────────────────────────────────────────────

  private toSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }

  private async signInterest<T extends { image: string | null }>(interest: T): Promise<T> {
    return {
      ...interest,
      image: interest.image
        ? await this.storageService.getPresignedDownloadUrl(interest.image)
        : null,
    };
  }

  async createInterest(dto: CreateInterestDto) {
    const slug = this.toSlug(dto.name);
    const existing = await this.prisma.interest.findFirst({
      where: { OR: [{ name: dto.name }, { slug }] },
    });
    if (existing) throw new ConflictException('An interest with this name already exists');

    const interest = await this.prisma.interest.create({
      data: { name: dto.name, slug, description: dto.description, image: dto.image },
    });
    void this.interestsService.invalidateCache();
    return this.signInterest(interest);
  }

  async getInterests() {
    const interests = await this.prisma.interest.findMany({
      orderBy: { name: 'asc' },
      include: {
        categoryMappings: {
          include: { category: { select: { id: true, name: true } } },
        },
      },
    });
    return Promise.all(interests.map((i) => this.signInterest(i)));
  }

  async getInterestById(id: string) {
    const interest = await this.prisma.interest.findUnique({
      where: { id },
      include: {
        categoryMappings: {
          include: { category: { select: { id: true, name: true } } },
        },
      },
    });
    if (!interest) throw new NotFoundException('Interest not found');
    return this.signInterest(interest);
  }

  async setInterestCategories(id: string, categoryIds: string[]) {
    const interest = await this.prisma.interest.findUnique({ where: { id } });
    if (!interest) throw new NotFoundException('Interest not found');

    const uniqueCategoryIds = [...new Set(categoryIds)];

    await this.prisma.$transaction([
      this.prisma.interestCategory.deleteMany({ where: { interestId: id } }),
      this.prisma.interestCategory.createMany({
        data: uniqueCategoryIds.map((categoryId) => ({ interestId: id, categoryId })),
      }),
    ]);

    return this.getInterestById(id);
  }

  async updateInterest(id: string, dto: UpdateInterestDto) {
    const interest = await this.prisma.interest.findUnique({ where: { id } });
    if (!interest) throw new NotFoundException('Interest not found');

    const slug = dto.name ? this.toSlug(dto.name) : undefined;

    if (slug && slug !== interest.slug) {
      const conflict = await this.prisma.interest.findFirst({
        where: { slug, NOT: { id } },
      });
      if (conflict) throw new ConflictException('An interest with this name already exists');
    }

    const updated = await this.prisma.interest.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name, slug }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.image !== undefined && { image: dto.image }),
      },
    });
    void this.interestsService.invalidateCache();
    return this.signInterest(updated);
  }

  // ─── Platform Config ────────────────────────────────────────────────────────

  async getPlatformConfig() {
    const configs = await this.prisma.platformConfig.findMany();
    return Object.fromEntries(configs.map((c) => [c.key, c.value]));
  }

  async updateGstRate(dto: UpdateGstRateDto) {
    await this.prisma.platformConfig.upsert({
      where: { key: 'gst_rate' },
      create: { key: 'gst_rate', value: String(dto.gstRate) },
      update: { value: String(dto.gstRate) },
    });
    await this.redis.del('platform_config:gst_rate');
    return { gstRate: dto.gstRate };
  }

  async updateSubscriptionPlanFeeRate(plan: string, dto: UpdatePlanFeeRateDto) {
    const existing = await this.prisma.subscriptionPlan.findUnique({ where: { plan: plan as any } });
    if (!existing) throw new NotFoundException(`Subscription plan '${plan}' not found`);
    const updated = await this.prisma.subscriptionPlan.update({
      where: { plan: plan as any },
      data: { platformFeeRate: dto.feeRate },
    });
    return { plan: updated.plan, platformFeeRate: updated.platformFeeRate };
  }

  // ─── Host Fee Promos ────────────────────────────────────────────────────────

  async createHostFeePromo(hostProfileId: string, dto: CreateHostFeePromoDto) {
    const host = await this.prisma.hostProfile.findUnique({ where: { id: hostProfileId }, select: { id: true } });
    if (!host) throw new NotFoundException('Host profile not found');
    return this.prisma.hostFeePromo.create({
      data: {
        hostProfileId,
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
        maxEvents: dto.maxEvents ?? null,
      },
    });
  }

  async getHostFeePromos(hostProfileId: string) {
    const host = await this.prisma.hostProfile.findUnique({ where: { id: hostProfileId }, select: { id: true } });
    if (!host) throw new NotFoundException('Host profile not found');
    return this.prisma.hostFeePromo.findMany({
      where: { hostProfileId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateHostFeePromo(hostProfileId: string, promoId: string, dto: UpdateHostFeePromoDto) {
    const promo = await this.prisma.hostFeePromo.findFirst({ where: { id: promoId, hostProfileId } });
    if (!promo) throw new NotFoundException('Fee promo not found');
    return this.prisma.hostFeePromo.update({
      where: { id: promoId },
      data: {
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.validUntil !== undefined && { validUntil: new Date(dto.validUntil) }),
      },
    });
  }

  async approveCampaign(id: string, adminId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: { brandProfile: { include: { user: { select: { id: true } } } } },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (campaign.status !== 'UNDER_REVIEW')
      throw new BadRequestException('Only campaigns in UNDER_REVIEW status can be approved');

    const { count } = await this.prisma.campaign.updateMany({
      where: { id, status: 'UNDER_REVIEW' },
      data: { status: 'PUBLISHED' },
    });
    if (count === 0)
      throw new BadRequestException('Campaign is no longer under review');

    const brandUser = campaign.brandProfile.user;

    this.auditLogService.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: 'CAMPAIGN_APPROVED' as any,
      entityType: 'CAMPAIGN',
      entityId: id,
      metadata: { name: campaign.name },
    });

    void this.notificationsService
      .create(
        brandUser.id,
        'campaign_approved',
        'Campaign Approved',
        `Your campaign "${campaign.name}" has been approved and is now published.`,
        { campaignId: id },
      )
      .catch((err) => this.logger.error('Failed to create campaign_approved notification', err));

    return { message: 'Campaign approved successfully' };
  }

  async rejectCampaign(id: string, adminId: string, dto: RejectEventDto) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: { brandProfile: { include: { user: { select: { id: true } } } } },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (campaign.status !== 'UNDER_REVIEW')
      throw new BadRequestException('Only campaigns in UNDER_REVIEW status can be rejected');

    const { count } = await this.prisma.campaign.updateMany({
      where: { id, status: 'UNDER_REVIEW' },
      data: { status: 'REJECTED', adminRejectionRemark: dto.remark },
    });
    if (count === 0)
      throw new BadRequestException('Campaign is no longer under review');

    const brandUser = campaign.brandProfile.user;

    this.auditLogService.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: 'CAMPAIGN_REJECTED' as any,
      entityType: 'CAMPAIGN',
      entityId: id,
      metadata: { name: campaign.name, remark: dto.remark },
    });

    void this.notificationsService
      .create(
        brandUser.id,
        'campaign_rejected',
        'Campaign Not Approved',
        `Your campaign "${campaign.name}" was not approved. Remark: ${dto.remark}`,
        { campaignId: id },
      )
      .catch((err) => this.logger.error('Failed to create campaign_rejected notification', err));

    return { message: 'Campaign rejected successfully' };
  }

  async listPendingCampaigns(page: number, limit: number) {
    const where = { status: 'UNDER_REVIEW' as const };
    const [campaigns, total] = await Promise.all([
      this.prisma.campaign.findMany({
        where,
        include: {
          brandProfile: {
            select: {
              id: true,
              brandName: true,
              user: { select: { firstName: true, lastName: true, email: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.campaign.count({ where }),
    ]);

    return { campaigns, total, page, limit };
  }

  async getCampaignDetail(id: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: {
        brandProfile: {
          select: {
            id: true,
            brandName: true,
            user: { select: { firstName: true, lastName: true, email: true } },
          },
        },
      },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  async listAllCampaigns(query: ListCampaignsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.city) {
      where.locations = {
        has: query.city,
      };
    }
    if (query.brandProfileId) where.brandProfileId = query.brandProfileId;

    const [campaigns, total] = await Promise.all([
      this.prisma.campaign.findMany({
        where,
        include: {
          brandProfile: {
            select: {
              id: true,
              brandName: true,
              user: { select: { firstName: true, lastName: true, email: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.campaign.count({ where }),
    ]);

    return { campaigns, total, page, limit };
  }

  async listCampaignDeals(status?: 'PENDING_APPROVAL' | 'CHANGES_REQUESTED' | 'APPROVED') {
    const deals = await this.prisma.sponsorshipDeal.findMany({
      where: {
        ...(status && { status }),
        sponsorshipInterest: { campaignId: { not: null } },
      },
      include: {
        sponsorshipInterest: {
          select: {
            id: true,
            campaign: { select: { id: true, name: true } },
            hostProfile: { select: { displayName: true, communityProfile: { select: { name: true } } } },
            brandProfile: { select: { id: true, brandName: true } },
          },
        },
        report: { select: { id: true } },
      },
      orderBy: [{ approvedAt: 'desc' }, { updatedAt: 'desc' }],
    });

    return Promise.all(
      deals.map(async (d) => {
        let breakdown: { platformFeeAmount: Prisma.Decimal | number | null; transactionFeeAmount: Prisma.Decimal | number | null; taxAmount: Prisma.Decimal | number | null; totalAmount: Prisma.Decimal | number | null } = {
          platformFeeAmount: d.platformFeeAmount,
          transactionFeeAmount: d.transactionFeeAmount,
          taxAmount: d.taxAmount,
          totalAmount: d.totalAmount,
        };
        if (d.platformFeeAmount == null) {
          const gstConfig = await this.prisma.platformConfig.findUnique({ where: { key: 'gst_rate' } });
          const gstRate = gstConfig ? parseFloat(gstConfig.value) : DEFAULT_SPONSORSHIP_GST_RATE;
          breakdown = computeDealPaymentBreakdown(Number(d.sponsorshipAmount), gstRate);
        }

        return {
          id: d.id,
          sponsorshipInterestId: d.sponsorshipInterest.id,
          proposalId: d.sponsorshipInterest.campaign?.id,
          proposalName: d.sponsorshipInterest.campaign?.name,
          communityName:
            d.sponsorshipInterest.hostProfile?.communityProfile?.name ??
            d.sponsorshipInterest.hostProfile?.displayName ??
            'Community',
          brandName: d.sponsorshipInterest.brandProfile.brandName,
          projectName: d.projectName,
          startDate: d.startDate,
          endDate: d.endDate,
          time: d.time,
          sponsorshipCategory: d.sponsorshipCategory,
          sponsorshipAmount: d.sponsorshipAmount,
          venue: d.venue,
          barterElements: d.barterElements,
          deliverables: d.deliverables,
          otherTerms: d.otherTerms,
          additionalNotes: d.additionalNotes,
          status: d.status,
          version: d.version,
          changeRequestNote: d.changeRequestNote,
          approvedAt: d.approvedAt,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
          hasReport: !!d.report,
          paymentStatus: d.paymentStatus,
          ...breakdown,
          paymentExpiresAt: d.paymentExpiresAt,
          paidAt: d.paidAt,
          razorpayPaymentId: d.razorpayPaymentId,
          invoicePdfKey: d.invoicePdfKey,
        };
      }),
    );
  }
}
