import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as firebaseAdmin from 'firebase-admin';
import { PrismaService } from '../../prisma/prisma.service';
import { ListHostsQueryDto } from './dto/list-hosts-query.dto';
import { ListAdminsQueryDto } from './dto/list-admins-query.dto';
import { ListRolesQueryDto } from './dto/list-roles-query.dto';
import { RejectHostDto } from './dto/reject-host.dto';
import { RejectEventDto } from './dto/reject-event.dto';
import { InviteAdminDto } from './dto/invite-admin.dto';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { ListCouponsQueryDto } from './dto/list-coupons-query.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { ListEventsQueryDto } from './dto/list-events-query.dto';
import { StorageService } from '../../common/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RedisService } from '../../common/redis/redis.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @InjectQueue('mail') private readonly mailQueue: Queue,
    private readonly storageService: StorageService,
    private readonly notificationsService: NotificationsService,
    private readonly redis: RedisService,
  ) {}

  async listAdmins(query: ListAdminsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const END_USER_ROLES = ['USER', 'HOST'];

    const where: any = {
      role: { name: { notIn: END_USER_ROLES } },
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
    const END_USER_ROLES = ['USER', 'HOST', 'SUPER_ADMIN'];

    return this.prisma.role.findMany({
      where: query.adminOnly ? { name: { notIn: END_USER_ROLES } } : undefined,
      select: { id: true, name: true, description: true },
      orderBy: { name: 'asc' },
    });
  }

  async inviteAdmin(dto: InviteAdminDto) {
    // Check DB for existing user with this email
    const existingInDb = await this.prisma.user.findFirst({ where: { email: dto.email } });
    if (existingInDb) {
      throw new ConflictException(`A user with email ${dto.email} already exists`);
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

    // Look up the role and guard against SUPER_ADMIN escalation
    const role = await this.prisma.role.findUnique({ where: { id: dto.roleId } });
    if (!role) {
      throw new BadRequestException('Invalid roleId');
    }
    if (role.name === 'SUPER_ADMIN') {
      throw new BadRequestException('SUPER_ADMIN cannot be granted via this endpoint');
    }
    if (role.name === 'CITY_ADMIN' && (!dto.managedCities || dto.managedCities.length === 0)) {
      throw new BadRequestException('managedCities is required for CITY_ADMIN');
    }

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

    // Dispatch invite email asynchronously
    void this.mailQueue.add('admin-invite', {
      to: dto.email,
      roleName: role.name,
      resetLink,
    });

    return { message: 'Invitation sent' };
  }

  async getOwnProfile(userId: string) {
    const admin = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
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
      },
    });

    if (!admin) {
      throw new NotFoundException('Admin not found');
    }

    return admin;
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

    void this.mailQueue.add('host-approved', {
      to: host.user.email,
      hostName: host.user.firstName,
    });
    void this.notificationsService.create(
      host.user.id,
      'host_approved',
      'Application Approved',
      "Your host application has been approved. You're now on the DISCOVER plan.",
    );

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

    return this.prisma.coupon.create({
      data: {
        code: dto.code,
        description: dto.description,
        target: dto.target,
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        maxUsages: dto.maxUsages,
        maxUsagesPerUser: dto.maxUsagesPerUser,
        isActive: true,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
        createdBy: creatingAdminId,
      },
    });
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
          _count: { select: { redemptions: true } },
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
        _count: { select: { redemptions: true } },
        createdByUser: { select: { id: true, firstName: true, lastName: true, email: true } },
        redemptions: {
          orderBy: { createdAt: 'desc' },
          include: {
            user: { select: { id: true, firstName: true, lastName: true, email: true } },
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

    void this.mailQueue.add('host-rejected', {
      to: host.user.email,
      hostName: host.user.firstName,
      reason: dto.rejectionReason,
    });
    void this.notificationsService.create(
      host.user.id,
      'host_rejected',
      'Application Not Approved',
      `Your host application was not approved. Reason: ${dto.rejectionReason}`,
    );

    return { message: 'Host rejected successfully' };
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
    return this.prisma.category.findMany({
      where: { isActive: true } as any,
      select: { id: true, name: true, description: true },
      orderBy: { name: 'asc' },
    });
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

    await this.prisma.event.update({
      where: { id: eventId },
      data: {
        status: 'PUBLISHED',
        reviewedBy: adminId,
        reviewedAt: new Date(),
      },
    });

    const hostUser = event.hostProfile.user;
    const eventTitle = event.title ?? 'Untitled';

    void this.mailQueue.add('event-approved', {
      to: hostUser.email,
      hostName: hostUser.firstName,
      eventTitle,
    });
    void this.notificationsService.create(
      hostUser.id,
      'event_approved',
      'Event Approved',
      `Your event "${eventTitle}" has been approved and is now live.`,
    );

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

    await this.prisma.event.update({
      where: { id: eventId },
      data: {
        status: 'DRAFT',
        adminRejectionRemark: dto.remark,
        reviewedBy: adminId,
        reviewedAt: new Date(),
      },
    });

    const hostUser = event.hostProfile.user;
    const eventTitle = event.title ?? 'Untitled';

    void this.mailQueue.add('event-rejected', {
      to: hostUser.email,
      hostName: hostUser.firstName,
      eventTitle,
      remark: dto.remark,
    });
    void this.notificationsService.create(
      hostUser.id,
      'event_rejected',
      'Event Not Approved',
      `Your event "${eventTitle}" was not approved. Remark: ${dto.remark}`,
    );

    return { message: 'Event rejected successfully' };
  }
}
