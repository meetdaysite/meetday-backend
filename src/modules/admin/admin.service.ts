import {
  BadRequestException,
  ConflictException,
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
import { ListRolesQueryDto } from './dto/list-roles-query.dto';
import { RejectHostDto } from './dto/reject-host.dto';
import { InviteAdminDto } from './dto/invite-admin.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @InjectQueue('mail') private readonly mailQueue: Queue,
  ) {}

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
    const existingInDb = await this.prisma.user.findUnique({ where: { email: dto.email } });
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

    return { message: 'Host approved successfully' };
  }

  async rejectHost(hostProfileId: string, _adminId: string, dto: RejectHostDto) {
    const host = await this.prisma.hostProfile.findUnique({
      where: { id: hostProfileId },
      include: { user: { select: { email: true, firstName: true } } },
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

    return { message: 'Host rejected successfully' };
  }
}
