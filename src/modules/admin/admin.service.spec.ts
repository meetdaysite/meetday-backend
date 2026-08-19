import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getQueueToken } from '@nestjs/bull';

// Mock firebase-admin before it is imported by AdminService
jest.mock('firebase-admin', () => ({
  apps: [],
  initializeApp: jest.fn(),
  credential: { cert: jest.fn().mockReturnValue({}) },
  auth: jest.fn().mockReturnValue({
    getUserByEmail: jest.fn(),
    createUser: jest.fn(),
    generatePasswordResetLink: jest.fn(),
    updateUser: jest.fn(),
  }),
}));
import * as firebaseAdmin from 'firebase-admin';

import { AdminService } from './admin.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../../common/storage/storage.service';
import { RedisService } from '../../common/redis/redis.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { InterestsService } from '../interests/interests.service';
import { RefundsService } from '../refunds/refunds.service';

// ── Mock factories ───────────────────────────────────────────────────────────

function makePrisma() {
  const prisma: any = {
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    role: { findUnique: jest.fn(), findMany: jest.fn() },
    hostProfile: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), count: jest.fn() },
    hostCommunityProfile: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn() },
    brandProfile: { findMany: jest.fn() },
    adminAnnouncement: { create: jest.fn().mockResolvedValue({ id: 'announcement-uuid' }), findMany: jest.fn(), count: jest.fn() },
    sponsorshipInterest: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), count: jest.fn() },
    sponsorshipDeal: { findMany: jest.fn() },
    sponsorshipChatMessage: { findMany: jest.fn(), create: jest.fn() },
    meetdayChatThread: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    meetdayChatMessage: { findMany: jest.fn(), create: jest.fn(), count: jest.fn() },
    coupon: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    category: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    event: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    order: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), updateMany: jest.fn() },
    interest: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    interestCategory: { deleteMany: jest.fn().mockResolvedValue({}), createMany: jest.fn().mockResolvedValue({}) },
  };
  prisma.$transaction = jest.fn().mockImplementation(async (fn: any) =>
    Array.isArray(fn) ? Promise.all(fn) : fn(prisma),
  );
  prisma.$executeRaw = jest.fn().mockResolvedValue(1);
  return prisma;
}

const mockMailQueue = { add: jest.fn().mockResolvedValue(undefined) };
const mockConfig = { get: jest.fn().mockReturnValue('http://localhost:3000') };

// Convenience: reference the mocked firebase-admin auth singleton
const mockAuth = (firebaseAdmin.auth as jest.Mock)();

// ── Fixtures ─────────────────────────────────────────────────────────────────

const adminId = 'admin-uuid';
const targetAdminId = 'target-admin-uuid';

const adminUser = {
  id: adminId,
  firebaseUid: 'fb-admin-uid',
  email: 'admin@meetday.in',
  firstName: 'Super',
  lastName: 'Admin',
  avatarUrl: null,
  isActive: true,
  role: { name: 'SUPER_ADMIN' },
};

const cityAdminRole = { id: 'role-city-admin', name: 'CITY_ADMIN' };
const moderatorRole = { id: 'role-mod', name: 'MODERATOR' };
const superAdminRole = { id: 'role-super', name: 'SUPER_ADMIN' };

const pendingHost = {
  id: 'hp-uuid',
  kycStatus: 'VERIFIED',
  approvalStatus: 'PENDING',
  user: { id: 'user-id', email: 'host@test.com', firstName: 'Priya', lastName: 'Nair', phone: null },
  categories: [],
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AdminService', () => {
  let service: AdminService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: mockConfig },
        { provide: getQueueToken('mail'), useValue: mockMailQueue },
        { provide: NotificationsService, useValue: { create: jest.fn().mockResolvedValue(undefined) } },
        { provide: StorageService, useValue: { getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://cdn.example.com/img') } },
        { provide: RedisService, useValue: { get: jest.fn().mockResolvedValue(null), set: jest.fn(), del: jest.fn() } },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        { provide: InterestsService, useValue: { invalidateCache: jest.fn().mockResolvedValue(undefined) } },
        { provide: RefundsService, useValue: { cancelEventOrders: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = module.get(AdminService);
  });

  // ── inviteAdmin() ────────────────────────────────────────────────────────

  describe('inviteAdmin()', () => {
    const dto = {
      email: 'new-admin@meetday.in',
      firstName: 'City',
      lastName: 'Manager',
      roleId: cityAdminRole.id,
      managedCities: ['Mumbai'],
    };

    beforeEach(() => {
      prisma.user.findFirst.mockResolvedValue(null); // not in DB
      mockAuth.getUserByEmail.mockRejectedValue({ errorInfo: { code: 'auth/user-not-found' } });
      mockAuth.createUser.mockResolvedValue({ uid: 'new-firebase-uid' });
      mockAuth.generatePasswordResetLink.mockResolvedValue('http://reset-link');
      prisma.role.findUnique.mockResolvedValue(cityAdminRole);
      prisma.user.create.mockResolvedValue({ id: 'new-user-id' });
    });

    it('creates Firebase user and DB user, dispatches invite email', async () => {
      await service.inviteAdmin(dto);

      expect(mockAuth.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ email: dto.email }),
      );
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isActive: false, mustCompleteProfile: true }),
        }),
      );
      expect(mockMailQueue.add).toHaveBeenCalledWith('admin-invite', expect.any(Object));
    });

    it('grants admin access to an existing user (e.g. HOST/BRAND) instead of rejecting', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'existing-user-id', adminRoleId: null });
      prisma.user.update.mockResolvedValue({ id: 'existing-user-id' });

      const result = await service.inviteAdmin(dto);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'existing-user-id' },
          data: expect.objectContaining({ adminRole: { connect: { id: cityAdminRole.id } } }),
        }),
      );
      expect(mockAuth.createUser).not.toHaveBeenCalled();
      expect(result).toEqual({ message: 'Admin access granted to existing account' });
    });

    it('throws ConflictException when the existing user already has admin access', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'existing-user-id', adminRoleId: 'some-role-id' });
      await expect(service.inviteAdmin(dto)).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when email already exists in Firebase', async () => {
      mockAuth.getUserByEmail.mockResolvedValue({ uid: 'existing-firebase-uid' });
      await expect(service.inviteAdmin(dto)).rejects.toThrow(ConflictException);
    });

    it('allows granting SUPER_ADMIN via invite', async () => {
      prisma.role.findUnique.mockResolvedValue(superAdminRole);
      await expect(
        service.inviteAdmin({ ...dto, roleId: superAdminRole.id }),
      ).resolves.toEqual({ message: 'Invitation sent' });
    });

    it('throws BadRequestException for CITY_ADMIN without managedCities', async () => {
      await expect(
        service.inviteAdmin({ ...dto, managedCities: [] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('does not require managedCities for MODERATOR role', async () => {
      prisma.role.findUnique.mockResolvedValue(moderatorRole);
      await expect(
        service.inviteAdmin({ ...dto, roleId: moderatorRole.id, managedCities: undefined }),
      ).resolves.toEqual({ message: 'Invitation sent' });
    });
  });

  // ── approveHost() ────────────────────────────────────────────────────────

  describe('approveHost()', () => {
    it('approves host, sends approval email', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue(pendingHost);
      prisma.hostProfile.update.mockResolvedValue({});

      await service.approveHost(pendingHost.id, adminId);

      expect(prisma.hostProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            approvalStatus: 'APPROVED',
            currentPlan: 'DISCOVER',
            approvedBy: adminId,
          }),
        }),
      );
      expect(mockMailQueue.add).toHaveBeenCalledWith('host-approved', expect.any(Object));
    });

    it('throws BadRequestException when KYC is not VERIFIED', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue({ ...pendingHost, kycStatus: 'PENDING' });
      await expect(service.approveHost(pendingHost.id, adminId)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when approval is not PENDING', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue({ ...pendingHost, approvalStatus: 'APPROVED' });
      await expect(service.approveHost(pendingHost.id, adminId)).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when host not found', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue(null);
      await expect(service.approveHost('bad-id', adminId)).rejects.toThrow(NotFoundException);
    });
  });

  // ── rejectHost() ────────────────────────────────────────────────────────

  describe('rejectHost()', () => {
    const rejectDto = { rejectionReason: 'Documents are incomplete and unverifiable.' };

    it('sets approvalStatus=REJECTED with reason and sends rejection email', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue(pendingHost);
      prisma.hostProfile.update.mockResolvedValue({});

      await service.rejectHost(pendingHost.id, adminId, rejectDto);

      expect(prisma.hostProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            approvalStatus: 'REJECTED',
            rejectionReason: rejectDto.rejectionReason,
          }),
        }),
      );
      expect(mockMailQueue.add).toHaveBeenCalledWith('host-rejected', expect.any(Object));
    });

    it('throws BadRequestException when host is not PENDING', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue({ ...pendingHost, approvalStatus: 'APPROVED' });
      await expect(service.rejectHost(pendingHost.id, adminId, rejectDto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── deactivateAdmin() ────────────────────────────────────────────────────

  describe('deactivateAdmin()', () => {
    const target = {
      id: targetAdminId,
      firebaseUid: 'fb-target-uid',
      isActive: true,
      role: { name: 'MODERATOR' },
    };

    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(target);
      prisma.user.update.mockResolvedValue({});
      mockAuth.updateUser.mockResolvedValue({});
    });

    it('deactivates target admin in DB and Firebase', async () => {
      await service.deactivateAdmin(targetAdminId, adminId);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isActive: false } }),
      );
      expect(mockAuth.updateUser).toHaveBeenCalledWith(target.firebaseUid, { disabled: true });
    });

    it('throws BadRequestException when deactivating self', async () => {
      await expect(service.deactivateAdmin(adminId, adminId)).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException when deactivating a SUPER_ADMIN', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...target, role: { name: 'SUPER_ADMIN' } });
      await expect(service.deactivateAdmin(targetAdminId, adminId)).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when target is a non-admin role (USER/HOST)', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...target, role: { name: 'USER' } });
      await expect(service.deactivateAdmin(targetAdminId, adminId)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when account is already inactive', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...target, isActive: false });
      await expect(service.deactivateAdmin(targetAdminId, adminId)).rejects.toThrow(BadRequestException);
    });
  });

  // ── reactivateAdmin() ────────────────────────────────────────────────────

  describe('reactivateAdmin()', () => {
    const inactiveTarget = {
      id: targetAdminId,
      firebaseUid: 'fb-target-uid',
      isActive: false,
      role: { name: 'MODERATOR' },
    };

    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(inactiveTarget);
      prisma.user.update.mockResolvedValue({});
      mockAuth.updateUser.mockResolvedValue({});
    });

    it('reactivates admin in DB and Firebase', async () => {
      await service.reactivateAdmin(targetAdminId, adminId);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isActive: true } }),
      );
      expect(mockAuth.updateUser).toHaveBeenCalledWith(inactiveTarget.firebaseUid, { disabled: false });
    });

    it('throws BadRequestException when reactivating self', async () => {
      await expect(service.reactivateAdmin(adminId, adminId)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when account is already active', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...inactiveTarget, isActive: true });
      await expect(service.reactivateAdmin(targetAdminId, adminId)).rejects.toThrow(BadRequestException);
    });
  });

  // ── createCoupon() ───────────────────────────────────────────────────────

  describe('createCoupon()', () => {
    const dto = {
      code: 'LAUNCH20',
      target: 'HOST' as const,
      discountType: 'PERCENTAGE' as const,
      discountValue: 20,
    };

    it('creates coupon successfully', async () => {
      prisma.coupon.findUnique.mockResolvedValue(null);
      prisma.coupon.create.mockResolvedValue({ id: 'coupon-id', ...dto });

      const result = await service.createCoupon(dto, adminId);
      expect(prisma.coupon.create).toHaveBeenCalled();
      expect(result).toMatchObject({ code: 'LAUNCH20' });
    });

    it('throws ConflictException for duplicate code', async () => {
      prisma.coupon.findUnique.mockResolvedValue({ id: 'existing' });
      await expect(service.createCoupon(dto, adminId)).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException when validFrom is after validUntil', async () => {
      prisma.coupon.findUnique.mockResolvedValue(null);
      const future = new Date(Date.now() + 86400000).toISOString();
      const past = new Date(Date.now() - 86400000).toISOString();
      await expect(
        service.createCoupon({ ...dto, validFrom: future, validUntil: past }, adminId),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── disableCoupon() ──────────────────────────────────────────────────────

  describe('disableCoupon()', () => {
    it('sets isActive=false', async () => {
      prisma.coupon.findUnique.mockResolvedValue({ id: 'coupon-id', isActive: true });
      prisma.coupon.update.mockResolvedValue({});

      await service.disableCoupon('coupon-id');
      expect(prisma.coupon.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isActive: false } }),
      );
    });

    it('throws BadRequestException when coupon is already inactive', async () => {
      prisma.coupon.findUnique.mockResolvedValue({ id: 'coupon-id', isActive: false });
      await expect(service.disableCoupon('coupon-id')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when coupon not found', async () => {
      prisma.coupon.findUnique.mockResolvedValue(null);
      await expect(service.disableCoupon('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ── createCategory() ─────────────────────────────────────────────────────

  describe('createCategory()', () => {
    const dto = { name: 'Food & Drink', description: 'Culinary experiences' };
    const created = { id: 'cat-uuid', name: 'Food & Drink', description: 'Culinary experiences', isActive: true, createdAt: new Date() };

    it('creates category successfully', async () => {
      prisma.category.findUnique.mockResolvedValue(null);
      prisma.category.create.mockResolvedValue(created);

      const result = await service.createCategory(dto);
      expect(prisma.category.create).toHaveBeenCalled();
      expect(result).toMatchObject({ name: 'Food & Drink', isActive: true });
    });

    it('throws ConflictException when name already exists', async () => {
      prisma.category.findUnique.mockResolvedValue({ id: 'existing-cat' });
      await expect(service.createCategory(dto)).rejects.toThrow(ConflictException);
    });
  });

  // ── updateCategory() ─────────────────────────────────────────────────────

  describe('updateCategory()', () => {
    const existing = { id: 'cat-uuid', name: 'Old Name', description: null, isActive: true };

    it('updates name successfully', async () => {
      prisma.category.findUnique
        .mockResolvedValueOnce(existing) // find the category
        .mockResolvedValueOnce(null);    // name conflict check
      prisma.category.update.mockResolvedValue({ ...existing, name: 'New Name' });

      const result = await service.updateCategory('cat-uuid', { name: 'New Name' });
      expect(prisma.category.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ name: 'New Name' }) }),
      );
      expect(result).toMatchObject({ name: 'New Name' });
    });

    it('deactivates category', async () => {
      prisma.category.findUnique.mockResolvedValueOnce(existing);
      prisma.category.update.mockResolvedValue({ ...existing, isActive: false });

      await service.updateCategory('cat-uuid', { isActive: false });
      expect(prisma.category.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }),
      );
    });

    it('throws NotFoundException when category does not exist', async () => {
      prisma.category.findUnique.mockResolvedValue(null);
      await expect(service.updateCategory('bad-id', { name: 'X' })).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when new name conflicts with another category', async () => {
      prisma.category.findUnique
        .mockResolvedValueOnce(existing)          // category found
        .mockResolvedValueOnce({ id: 'other' });  // conflict found
      await expect(service.updateCategory('cat-uuid', { name: 'Conflicting Name' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('does not check name conflict when name is unchanged', async () => {
      prisma.category.findUnique.mockResolvedValueOnce(existing); // only called once
      prisma.category.update.mockResolvedValue(existing);

      await service.updateCategory('cat-uuid', { name: existing.name });
      expect(prisma.category.findUnique).toHaveBeenCalledTimes(1);
    });
  });

  // ── listAdmins() ─────────────────────────────────────────────────────────

  describe('listAdmins()', () => {
    it('returns paginated admin list', async () => {
      prisma.user.findMany.mockResolvedValue([adminUser]);
      prisma.user.count.mockResolvedValue(1);

      const result = await service.listAdmins({});
      expect(result).toMatchObject({ total: 1, page: 1 });
    });

    it('applies role filter when provided', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      await service.listAdmins({ role: 'MODERATOR' } as any);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ role: { name: 'MODERATOR' } }) }),
      );
    });
  });

  // ── getRoles() ────────────────────────────────────────────────────────────

  describe('getRoles()', () => {
    it('returns all roles when adminOnly is false', async () => {
      prisma.role.findMany.mockResolvedValue([moderatorRole]);
      const result = await service.getRoles({});
      expect(result).toEqual([moderatorRole]);
      expect(prisma.role.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: undefined }),
      );
    });

    it('excludes end-user roles when adminOnly=true', async () => {
      prisma.role.findMany.mockResolvedValue([moderatorRole]);
      await service.getRoles({ adminOnly: true });
      expect(prisma.role.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { name: { notIn: expect.any(Array) } } }),
      );
    });
  });

  // ── inviteAdmin() — role not found ────────────────────────────────────────

  describe('inviteAdmin() — role not found', () => {
    it('throws BadRequestException when roleId does not exist', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      mockAuth.getUserByEmail.mockRejectedValue({ errorInfo: { code: 'auth/user-not-found' } });
      mockAuth.createUser.mockResolvedValue({ uid: 'new-uid' });
      mockAuth.generatePasswordResetLink.mockResolvedValue('http://reset-link');
      prisma.role.findUnique.mockResolvedValue(null);

      await expect(service.inviteAdmin({
        email: 'new@test.com',
        firstName: 'A',
        lastName: 'B',
        roleId: 'bad-role-id',
      })).rejects.toThrow(BadRequestException);
    });
  });

  // ── getOwnProfile() ───────────────────────────────────────────────────────

  describe('getOwnProfile()', () => {
    it('returns admin user details', async () => {
      prisma.user.findUnique.mockResolvedValue(adminUser);
      const result = await service.getOwnProfile(adminId);
      expect(result).toEqual(adminUser);
    });

    it('throws NotFoundException when admin not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getOwnProfile('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ── listPendingHosts() ────────────────────────────────────────────────────

  describe('listPendingHosts()', () => {
    it('returns hosts with kycStatus=VERIFIED and approvalStatus=PENDING', async () => {
      prisma.hostProfile.findMany.mockResolvedValue([pendingHost]);
      prisma.hostProfile.count.mockResolvedValue(1);

      const result = await service.listPendingHosts({});
      expect(result.total).toBe(1);
      expect(prisma.hostProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { kycStatus: 'VERIFIED', approvalStatus: 'PENDING' } }),
      );
    });
  });

  // ── listAllHosts() ────────────────────────────────────────────────────────

  describe('listAllHosts()', () => {
    it('returns paginated host list', async () => {
      prisma.hostProfile.findMany.mockResolvedValue([pendingHost]);
      prisma.hostProfile.count.mockResolvedValue(1);

      const result = await service.listAllHosts({});
      expect(result.total).toBe(1);
    });
  });

  // ── getHostDetail() ───────────────────────────────────────────────────────

  describe('getHostDetail()', () => {
    it('returns host with full detail', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue(pendingHost);
      const result = await service.getHostDetail(pendingHost.id);
      expect(result).toEqual(pendingHost);
    });

    it('throws NotFoundException when host not found', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue(null);
      await expect(service.getHostDetail('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ── rejectHost() — NotFoundException ─────────────────────────────────────

  describe('rejectHost() — additional', () => {
    it('throws NotFoundException when host not found', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue(null);
      await expect(
        service.rejectHost('bad-id', adminId, { rejectionReason: 'reason' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── listHostsWithoutCommunityProfile() ───────────────────────────────────

  describe('listHostsWithoutCommunityProfile()', () => {
    it('queries hosts whose communityProfile is null', async () => {
      prisma.hostProfile.findMany.mockResolvedValue([pendingHost]);
      prisma.hostProfile.count.mockResolvedValue(1);

      const result = await service.listHostsWithoutCommunityProfile({});
      expect(result.total).toBe(1);
      expect(prisma.hostProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ communityProfile: null }) }),
      );
    });

    it('adds a name/email search filter when provided', async () => {
      prisma.hostProfile.findMany.mockResolvedValue([]);
      prisma.hostProfile.count.mockResolvedValue(0);

      await service.listHostsWithoutCommunityProfile({ search: 'priya' });
      expect(prisma.hostProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ OR: expect.any(Array) }) }),
      );
    });
  });

  // ── sendAnnouncement() ───────────────────────────────────────────────────

  describe('sendAnnouncement()', () => {
    it('queues one mail job per unique recipient email when allBrands+allCommunity are selected', async () => {
      prisma.brandProfile.findMany.mockResolvedValue([
        { user: { email: 'brand1@test.com' } },
        { user: { email: 'brand2@test.com' } },
      ]);
      prisma.hostProfile.findMany.mockResolvedValue([{ user: { email: 'host1@test.com' } }]);

      const result = await service.sendAnnouncement(
        { allBrands: true, allCommunity: true, message: 'Hello everyone' },
        adminId,
      );

      expect(result).toEqual({ queued: 3 });
      expect(mockMailQueue.add).toHaveBeenCalledTimes(3);
      expect(mockMailQueue.add).toHaveBeenCalledWith(
        'announcement',
        expect.objectContaining({ to: 'brand1@test.com', message: 'Hello everyone' }),
      );
    });

    it('only queries specific brandIds/hostIds when allBrands/allCommunity are false', async () => {
      prisma.brandProfile.findMany.mockResolvedValue([{ user: { email: 'brand1@test.com' } }]);
      prisma.hostProfile.findMany.mockResolvedValue([]);

      await service.sendAnnouncement({ brandIds: ['brand-1'], message: 'Hi' }, adminId);

      expect(prisma.brandProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['brand-1'] } } }),
      );
      expect(prisma.hostProfile.findMany).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when no recipients match', async () => {
      await expect(service.sendAnnouncement({ message: 'Hi' }, adminId)).rejects.toThrow(BadRequestException);
      expect(mockMailQueue.add).not.toHaveBeenCalled();
    });
  });

  // ── listAnnouncements() ──────────────────────────────────────────────────

  describe('listAnnouncements()', () => {
    it('returns a paginated, newest-first list', async () => {
      prisma.adminAnnouncement.findMany.mockResolvedValue([{ id: 'a1', subject: 'Hi', recipientCount: 3 }]);
      prisma.adminAnnouncement.count.mockResolvedValue(1);

      const result = await service.listAnnouncements({});
      expect(result).toEqual({ announcements: [{ id: 'a1', subject: 'Hi', recipientCount: 3 }], total: 1, page: 1, limit: 20 });
      expect(prisma.adminAnnouncement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
      );
    });
  });

  // ── createCommunityProfileAsAdmin() ──────────────────────────────────────

  describe('createCommunityProfileAsAdmin()', () => {
    const createDto = {
      hostProfileId: 'hp-uuid',
      name: 'Bangalore Founders Circle',
      about: 'A community of early-stage founders.',
      logoKey: 'logo-key',
      size: '250',
      avgGuestCount: '60',
      experiencesPerYear: '12',
      categoryIds: ['cat-1'],
    };

    it('creates an APPROVED community profile and notifies the host', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue({
        id: 'hp-uuid',
        communityProfile: null,
        user: { id: 'user-id' },
      });
      prisma.category.findMany.mockResolvedValue([{ id: 'cat-1' }]);
      prisma.hostCommunityProfile.create.mockResolvedValue({ id: 'profile-uuid', name: createDto.name });
      prisma.hostCommunityProfile.findUnique.mockResolvedValue({
        id: 'profile-uuid',
        name: createDto.name,
        logoKey: 'logo-key',
        categories: [],
      });

      const result = await service.createCommunityProfileAsAdmin(adminId, createDto as any);

      expect(prisma.hostCommunityProfile.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ hostProfileId: 'hp-uuid', approvalStatus: 'APPROVED', reviewedBy: adminId }),
        }),
      );
      expect(result).toEqual(expect.objectContaining({ id: 'profile-uuid' }));
    });

    it('throws NotFoundException when host profile does not exist', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue(null);
      await expect(service.createCommunityProfileAsAdmin(adminId, createDto as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException when the host already has a community profile', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue({
        id: 'hp-uuid',
        communityProfile: { id: 'existing-profile' },
        user: { id: 'user-id' },
      });
      await expect(service.createCommunityProfileAsAdmin(adminId, createDto as any)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws BadRequestException when a categoryId is invalid', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue({
        id: 'hp-uuid',
        communityProfile: null,
        user: { id: 'user-id' },
      });
      prisma.category.findMany.mockResolvedValue([]);
      await expect(service.createCommunityProfileAsAdmin(adminId, createDto as any)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── suspendHost() ─────────────────────────────────────────────────────────

  describe('suspendHost()', () => {
    const approvedHost = { ...pendingHost, approvalStatus: 'APPROVED' };

    it('suspends an approved host', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue(approvedHost);
      prisma.hostProfile.update.mockResolvedValue({});

      await service.suspendHost(pendingHost.id, adminId, { reason: 'Violation of ToS' });

      expect(prisma.hostProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ approvalStatus: 'SUSPENDED', rejectionReason: 'Violation of ToS' }),
        }),
      );
    });

    it('throws BadRequestException when host is not APPROVED', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue(pendingHost); // PENDING status
      await expect(
        service.suspendHost(pendingHost.id, adminId, { reason: 'reason' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when host not found', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue(null);
      await expect(
        service.suspendHost('bad-id', adminId, { reason: 'reason' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── restoreHost() ─────────────────────────────────────────────────────────

  describe('restoreHost()', () => {
    const suspendedHost = { ...pendingHost, approvalStatus: 'SUSPENDED' };

    it('restores a suspended host back to APPROVED', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue(suspendedHost);
      prisma.hostProfile.update.mockResolvedValue({});

      await service.restoreHost(pendingHost.id, adminId);

      expect(prisma.hostProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ approvalStatus: 'APPROVED', rejectionReason: null }),
        }),
      );
    });

    it('throws BadRequestException when host is not suspended', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue(pendingHost); // PENDING
      await expect(service.restoreHost(pendingHost.id, adminId)).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when host not found', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue(null);
      await expect(service.restoreHost('bad-id', adminId)).rejects.toThrow(NotFoundException);
    });
  });

  // ── listCoupons() ─────────────────────────────────────────────────────────

  describe('listCoupons()', () => {
    it('returns paginated coupon list', async () => {
      prisma.coupon.findMany.mockResolvedValue([{ id: 'c1', code: 'TEST10' }]);
      prisma.coupon.count.mockResolvedValue(1);

      const result = await service.listCoupons({});
      expect(result.total).toBe(1);
    });
  });

  // ── getCouponDetail() ─────────────────────────────────────────────────────

  describe('getCouponDetail()', () => {
    it('returns coupon with redemptions', async () => {
      const coupon = { id: 'c1', code: 'TEST10', redemptions: [], _count: { redemptions: 0 } };
      prisma.coupon.findUnique.mockResolvedValue(coupon);

      const result = await service.getCouponDetail('c1');
      expect(result).toEqual(coupon);
    });

    it('throws NotFoundException when coupon not found', async () => {
      prisma.coupon.findUnique.mockResolvedValue(null);
      await expect(service.getCouponDetail('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ── listPendingEvents() ───────────────────────────────────────────────────

  describe('listPendingEvents()', () => {
    it('returns events with UNDER_REVIEW status ordered oldest first', async () => {
      prisma.event.findMany.mockResolvedValue([{ id: 'e1', status: 'UNDER_REVIEW' }]);
      prisma.event.count.mockResolvedValue(1);

      const result = await service.listPendingEvents(1, 20);
      expect(result.total).toBe(1);
      expect(prisma.event.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'UNDER_REVIEW' } }),
      );
    });
  });

  // ── approveEvent() ────────────────────────────────────────────────────────

  describe('approveEvent()', () => {
    const underReviewEvent = {
      id: 'event-uuid',
      title: 'Indie Night',
      status: 'UNDER_REVIEW',
      hostProfile: {
        user: { id: 'user-id', email: 'host@test.com', firstName: 'Priya' },
      },
    };

    it('publishes the event and dispatches approval email', async () => {
      prisma.event.findUnique.mockResolvedValue(underReviewEvent);
      prisma.event.updateMany.mockResolvedValue({ count: 1 });

      await service.approveEvent('event-uuid', adminId);

      expect(prisma.event.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'UNDER_REVIEW' }),
          data: expect.objectContaining({ status: 'PUBLISHED' }),
        }),
      );
      expect(mockMailQueue.add).toHaveBeenCalledWith('event-approved', expect.any(Object));
    });

    it('aborts without publishing when the event was recalled (0 rows updated)', async () => {
      prisma.event.findUnique.mockResolvedValue(underReviewEvent);
      prisma.event.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.approveEvent('event-uuid', adminId)).rejects.toThrow(BadRequestException);
      expect(mockMailQueue.add).not.toHaveBeenCalledWith('event-approved', expect.any(Object));
    });

    it('throws BadRequestException when event is not UNDER_REVIEW', async () => {
      prisma.event.findUnique.mockResolvedValue({ ...underReviewEvent, status: 'DRAFT' });
      await expect(service.approveEvent('event-uuid', adminId)).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when event not found', async () => {
      prisma.event.findUnique.mockResolvedValue(null);
      await expect(service.approveEvent('bad-id', adminId)).rejects.toThrow(NotFoundException);
    });
  });

  // ── listAllEvents() ───────────────────────────────────────────────────────

  describe('listAllEvents()', () => {
    it('returns paginated event list', async () => {
      prisma.event.findMany.mockResolvedValue([{ id: 'e1', status: 'PUBLISHED' }]);
      prisma.event.count.mockResolvedValue(1);

      const result = await service.listAllEvents({});
      expect(result.total).toBe(1);
    });
  });

  // ── getEventDetail() ──────────────────────────────────────────────────────

  describe('getEventDetail()', () => {
    it('returns event with signed media URLs', async () => {
      prisma.event.findUnique.mockResolvedValue({
        id: 'event-uuid',
        title: 'Indie Night',
        media: [{ url: 'covers/img.jpg', type: 'COVER', order: 0 }],
      });

      const result = await service.getEventDetail('event-uuid');
      expect(result.media[0].url).toBe('https://cdn.example.com/img');
    });

    it('returns event with empty media when no media exists', async () => {
      prisma.event.findUnique.mockResolvedValue({ id: 'event-uuid', title: 'Indie Night', media: [] });
      const result = await service.getEventDetail('event-uuid');
      expect(result.media).toHaveLength(0);
    });

    it('throws NotFoundException when event not found', async () => {
      prisma.event.findUnique.mockResolvedValue(null);
      await expect(service.getEventDetail('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ── rejectEvent() ─────────────────────────────────────────────────────────

  describe('rejectEvent()', () => {
    const underReviewEvent = {
      id: 'event-uuid',
      title: 'Indie Night',
      status: 'UNDER_REVIEW',
      hostProfile: {
        user: { id: 'user-id', email: 'host@test.com', firstName: 'Priya' },
      },
    };

    it('reverts event to DRAFT with rejection remark and sends email', async () => {
      prisma.event.findUnique.mockResolvedValue(underReviewEvent);
      prisma.event.updateMany.mockResolvedValue({ count: 1 });

      await service.rejectEvent('event-uuid', adminId, { remark: 'Incomplete description' });

      expect(prisma.event.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'UNDER_REVIEW' }),
          data: expect.objectContaining({ status: 'DRAFT', adminRejectionRemark: 'Incomplete description' }),
        }),
      );
      expect(mockMailQueue.add).toHaveBeenCalledWith('event-rejected', expect.any(Object));
    });

    it('aborts without stamping a rejection when the event was recalled (0 rows updated)', async () => {
      prisma.event.findUnique.mockResolvedValue(underReviewEvent);
      prisma.event.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.rejectEvent('event-uuid', adminId, { remark: 'remark' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockMailQueue.add).not.toHaveBeenCalledWith('event-rejected', expect.any(Object));
    });

    it('throws BadRequestException when event is not UNDER_REVIEW', async () => {
      prisma.event.findUnique.mockResolvedValue({ ...underReviewEvent, status: 'PUBLISHED' });
      await expect(service.rejectEvent('event-uuid', adminId, { remark: 'remark' })).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when event not found', async () => {
      prisma.event.findUnique.mockResolvedValue(null);
      await expect(service.rejectEvent('bad-id', adminId, { remark: 'remark' })).rejects.toThrow(NotFoundException);
    });
  });

  // ── forceCancelEvent() ────────────────────────────────────────────────────

  describe('forceCancelEvent()', () => {
    const publishedEvent = {
      id: 'event-uuid',
      title: 'Indie Night',
      status: 'PUBLISHED',
      hostProfile: {
        user: { id: 'user-id', email: 'host@test.com', firstName: 'Priya' },
      },
    };

    beforeEach(() => {
      prisma.event.findUnique.mockResolvedValue(publishedEvent);
      prisma.order.findMany.mockResolvedValue([]);
      prisma.event.update.mockResolvedValue({ ...publishedEvent, status: 'CANCELLED' });
    });

    it('force-cancels a PUBLISHED event with no pending orders', async () => {
      const result = await service.forceCancelEvent('event-uuid', adminId, { reason: 'Safety concern' });

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result).toMatchObject({ pendingOrdersCancelled: 0 });
      expect(mockMailQueue.add).toHaveBeenCalledWith('event-force-cancelled', expect.any(Object));
    });

    it('also works on UNDER_REVIEW events', async () => {
      prisma.event.findUnique.mockResolvedValue({ ...publishedEvent, status: 'UNDER_REVIEW' });
      const result = await service.forceCancelEvent('event-uuid', adminId, { reason: 'Safety concern' });
      expect(result.pendingOrdersCancelled).toBe(0);
    });

    it('throws BadRequestException when event is in DRAFT status', async () => {
      prisma.event.findUnique.mockResolvedValue({ ...publishedEvent, status: 'DRAFT' });
      await expect(
        service.forceCancelEvent('event-uuid', adminId, { reason: 'reason' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when event not found', async () => {
      prisma.event.findUnique.mockResolvedValue(null);
      await expect(
        service.forceCancelEvent('bad-id', adminId, { reason: 'reason' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rolls back soldCount and cancels pending orders', async () => {
      prisma.order.findMany.mockResolvedValue([{
        id: 'order-uuid',
        couponId: null,
        items: [{ id: 'item-uuid', ticketId: 'ticket-uuid', quantity: 1, cancelledCount: 0, attendees: [] }],
      }]);
      prisma.order.updateMany.mockResolvedValue({});

      const result = await service.forceCancelEvent('event-uuid', adminId, { reason: 'Safety' });

      expect(prisma.$executeRaw).toHaveBeenCalled();
      expect(result.pendingOrdersCancelled).toBe(1);
    });
  });

  // ── listOrders() ──────────────────────────────────────────────────────────

  describe('listOrders()', () => {
    it('returns paginated order list', async () => {
      prisma.order.findMany.mockResolvedValue([{ id: 'o1' }]);
      prisma.order.count.mockResolvedValue(1);

      const result = await service.listOrders({});
      expect(result.total).toBe(1);
    });
  });

  // ── getOrderDetail() ──────────────────────────────────────────────────────

  describe('getOrderDetail()', () => {
    it('returns order detail', async () => {
      const order = { id: 'o1', bookingId: 'BK-001', status: 'CONFIRMED' };
      prisma.order.findUnique.mockResolvedValue(order);

      const result = await service.getOrderDetail('o1');
      expect(result).toEqual(order);
    });

    it('throws NotFoundException when order not found', async () => {
      prisma.order.findUnique.mockResolvedValue(null);
      await expect(service.getOrderDetail('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ── createInterest() ──────────────────────────────────────────────────────

  describe('createInterest()', () => {
    it('creates interest with generated slug and invalidates cache', async () => {
      prisma.interest.findFirst.mockResolvedValue(null);
      prisma.interest.create.mockResolvedValue({ id: 'i1', name: 'Live Music', slug: 'live-music' });

      const result = await service.createInterest({ name: 'Live Music' } as any);
      expect(prisma.interest.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ slug: 'live-music' }) }),
      );
      expect(result).toMatchObject({ slug: 'live-music' });
    });

    it('throws ConflictException when name or slug already exists', async () => {
      prisma.interest.findFirst.mockResolvedValue({ id: 'existing' });
      await expect(service.createInterest({ name: 'Live Music' } as any)).rejects.toThrow(ConflictException);
    });
  });

  // ── getInterests() ────────────────────────────────────────────────────────

  describe('getInterests()', () => {
    it('returns all interests with category mappings', async () => {
      prisma.interest.findMany.mockResolvedValue([{ id: 'i1', name: 'Music', categoryMappings: [] }]);
      const result = await service.getInterests();
      expect(result).toHaveLength(1);
    });
  });

  // ── getInterestById() ─────────────────────────────────────────────────────

  describe('getInterestById()', () => {
    it('returns interest with category mappings', async () => {
      prisma.interest.findUnique.mockResolvedValue({ id: 'i1', name: 'Music', categoryMappings: [] });
      const result = await service.getInterestById('i1');
      expect(result).toMatchObject({ name: 'Music' });
    });

    it('throws NotFoundException when interest not found', async () => {
      prisma.interest.findUnique.mockResolvedValue(null);
      await expect(service.getInterestById('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ── setInterestCategories() ───────────────────────────────────────────────

  describe('setInterestCategories()', () => {
    it('replaces category mappings via transaction and returns updated interest', async () => {
      prisma.interest.findUnique.mockResolvedValue({ id: 'i1', name: 'Music', categoryMappings: [] });

      await service.setInterestCategories('i1', ['cat-1', 'cat-2']);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.interestCategory.deleteMany).toHaveBeenCalledWith({ where: { interestId: 'i1' } });
      expect(prisma.interestCategory.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.arrayContaining([{ interestId: 'i1', categoryId: 'cat-1' }]) }),
      );
    });

    it('deduplicates categoryIds before creating', async () => {
      prisma.interest.findUnique.mockResolvedValue({ id: 'i1', name: 'Music', categoryMappings: [] });

      await service.setInterestCategories('i1', ['cat-1', 'cat-1', 'cat-2']);

      expect(prisma.interestCategory.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.arrayContaining([{ interestId: 'i1', categoryId: 'cat-1' }]) }),
      );
      const callArg = prisma.interestCategory.createMany.mock.calls[0][0];
      expect(callArg.data).toHaveLength(2); // deduplicated
    });

    it('throws NotFoundException when interest not found', async () => {
      prisma.interest.findUnique.mockResolvedValue(null);
      await expect(service.setInterestCategories('bad-id', [])).rejects.toThrow(NotFoundException);
    });
  });

  // ── updateInterest() ──────────────────────────────────────────────────────

  describe('updateInterest()', () => {
    const existingInterest = { id: 'i1', name: 'Music', slug: 'music', description: null, image: null };

    it('updates name and regenerates slug', async () => {
      prisma.interest.findUnique.mockResolvedValue(existingInterest);
      prisma.interest.findFirst.mockResolvedValue(null); // no slug conflict
      prisma.interest.update.mockResolvedValue({ ...existingInterest, name: 'Live Music', slug: 'live-music' });

      const result = await service.updateInterest('i1', { name: 'Live Music' });
      expect(prisma.interest.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ name: 'Live Music', slug: 'live-music' }) }),
      );
      expect(result).toMatchObject({ slug: 'live-music' });
    });

    it('throws ConflictException when new slug conflicts with another interest', async () => {
      prisma.interest.findUnique.mockResolvedValue(existingInterest);
      prisma.interest.findFirst.mockResolvedValue({ id: 'other-id' }); // conflict

      await expect(service.updateInterest('i1', { name: 'Dance' })).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when interest not found', async () => {
      prisma.interest.findUnique.mockResolvedValue(null);
      await expect(service.updateInterest('bad-id', { name: 'X' })).rejects.toThrow(NotFoundException);
    });
  });

  // \u2500\u2500 TriChat (admin) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  describe('sponsorship chats (TriChat)', () => {
    it('listSponsorshipChats() maps threads with a counterpart summary', async () => {
      prisma.sponsorshipInterest.findMany.mockResolvedValue([
        {
          id: 'interest-1',
          chatStatus: 'REQUESTED',
          createdAt: new Date(),
          chatAcceptedAt: null,
          lastMessageAt: null,
          sponsorshipProposal: { id: 'prop-1', name: 'Summer Fest', hostProfile: { displayName: 'Host', communityProfile: null } },
          brandProfile: { id: 'brand-1', brandName: 'Acme' },
          chatMessages: [],
        },
      ]);

      const result = await service.listSponsorshipChats({});
      expect(result).toEqual([
        expect.objectContaining({ id: 'interest-1', proposalName: 'Summer Fest', brandName: 'Acme', communityName: 'Host' }),
      ]);
    });

    it('sendSponsorshipChatMessage() posts as ADMIN and notifies both host and brand', async () => {
      prisma.sponsorshipInterest.findUnique.mockResolvedValue({
        id: 'interest-1',
        sponsorshipProposal: { hostProfile: { userId: 'host-user' } },
        brandProfile: { userId: 'brand-user' },
      });
      prisma.sponsorshipChatMessage.create.mockResolvedValue({ id: 'msg-1', createdAt: new Date() });

      await service.sendSponsorshipChatMessage('interest-1', 'admin-uuid', { content: 'Hi from Meetday' });

      expect(prisma.sponsorshipChatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ senderType: 'ADMIN', senderId: 'admin-uuid' }) }),
      );
    });

    it('sendSponsorshipChatMessage() schedules a deduped unread-chat-email check for both host and brand', async () => {
      prisma.sponsorshipInterest.findUnique.mockResolvedValue({
        id: 'interest-1',
        sponsorshipProposal: { hostProfile: { userId: 'host-user' } },
        brandProfile: { userId: 'brand-user' },
      });
      prisma.sponsorshipChatMessage.create.mockResolvedValue({ id: 'msg-1', createdAt: new Date() });

      await service.sendSponsorshipChatMessage('interest-1', 'admin-uuid', { content: 'Hi from Meetday' });

      expect(mockMailQueue.add).toHaveBeenCalledWith(
        'unread-chat-message-check',
        { interestId: 'interest-1', recipientUserId: 'host-user' },
        expect.objectContaining({ jobId: 'unread-chat:interest-1:host-user', removeOnComplete: true, removeOnFail: true }),
      );
      expect(mockMailQueue.add).toHaveBeenCalledWith(
        'unread-chat-message-check',
        { interestId: 'interest-1', recipientUserId: 'brand-user' },
        expect.objectContaining({ jobId: 'unread-chat:interest-1:brand-user', removeOnComplete: true, removeOnFail: true }),
      );
    });

    it('getSponsorshipChatMessages() throws NotFoundException for an unknown thread', async () => {
      prisma.sponsorshipInterest.findUnique.mockResolvedValue(null);
      await expect(service.getSponsorshipChatMessages('bad-id')).rejects.toThrow(NotFoundException);
    });

    it('countPendingSponsorshipChats() counts only REQUESTED threads', async () => {
      prisma.sponsorshipInterest.count.mockResolvedValue(4);
      const result = await service.countPendingSponsorshipChats();
      expect(prisma.sponsorshipInterest.count).toHaveBeenCalledWith({ where: { chatStatus: 'REQUESTED' } });
      expect(result).toBe(4);
    });
  });

  describe('sponsorship deals (Deal Lock)', () => {
    it('listSponsorshipDeals() maps deals with community/brand names, optionally filtered by status', async () => {
      prisma.sponsorshipDeal.findMany.mockResolvedValue([
        {
          id: 'deal-1',
          eventName: 'Summer Fest',
          eventDate: new Date(),
          eventTime: '6pm',
          venue: 'Phoenix Marketcity',
          finalAmount: 45000,
          deliverables: 'Logo on backdrop',
          otherTerms: null,
          additionalNotes: null,
          status: 'APPROVED',
          version: 2,
          changeRequestNote: null,
          approvedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          sponsorshipInterest: {
            id: 'interest-1',
            sponsorshipProposal: { id: 'prop-1', name: 'Summer Fest Proposal', hostProfile: { displayName: 'Host', communityProfile: null } },
            brandProfile: { id: 'brand-1', brandName: 'Acme' },
          },
        },
      ]);

      const result = await service.listSponsorshipDeals('APPROVED');

      expect(prisma.sponsorshipDeal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'APPROVED' } }),
      );
      expect(result).toEqual([
        expect.objectContaining({ id: 'deal-1', proposalName: 'Summer Fest Proposal', communityName: 'Host', brandName: 'Acme', status: 'APPROVED' }),
      ]);
    });
  });

  describe('"Talk to Meetday" general chat', () => {
    it('listMeetdayChats() maps threads with an unread count', async () => {
      prisma.meetdayChatThread.findMany.mockResolvedValue([
        {
          id: 'thread-1',
          userId: 'user-1',
          createdAt: new Date(),
          lastMessageAt: new Date(),
          adminLastReadAt: null,
          user: { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', role: { name: 'HOST' } },
          messages: [{ content: 'Need help', mediaKey: null, createdAt: new Date() }],
        },
      ]);
      prisma.meetdayChatMessage.count.mockResolvedValue(2);

      const result = await service.listMeetdayChats();

      expect(result).toEqual([
        expect.objectContaining({
          id: 'thread-1',
          userId: 'user-1',
          userName: 'Jane Doe',
          userEmail: 'jane@example.com',
          lastMessagePreview: 'Need help',
          unreadCount: 2,
        }),
      ]);
    });

    it('getMeetdayChatMessages() throws NotFoundException for an unknown thread', async () => {
      prisma.meetdayChatThread.findUnique.mockResolvedValue(null);
      await expect(service.getMeetdayChatMessages('bad-id')).rejects.toThrow(NotFoundException);
    });

    it('sendMeetdayChatMessage() posts as ADMIN and notifies the thread owner only', async () => {
      prisma.meetdayChatThread.findUnique.mockResolvedValue({ id: 'thread-1', userId: 'user-1' });
      prisma.meetdayChatMessage.create.mockResolvedValue({ id: 'msg-1', createdAt: new Date() });

      await service.sendMeetdayChatMessage('thread-1', 'admin-uuid', { content: 'Hi from Meetday' });

      expect(prisma.meetdayChatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ threadId: 'thread-1', senderType: 'ADMIN', senderId: 'admin-uuid' }) }),
      );
    });

    it('sendMeetdayChatMessage() rejects a message with no text and no image', async () => {
      prisma.meetdayChatThread.findUnique.mockResolvedValue({ id: 'thread-1', userId: 'user-1' });
      await expect(service.sendMeetdayChatMessage('thread-1', 'admin-uuid', {})).rejects.toThrow(BadRequestException);
    });

    it('countUnreadMeetdayChats() counts only threads with an unread user message', async () => {
      prisma.meetdayChatThread.findMany.mockResolvedValue([
        { id: 'thread-1', adminLastReadAt: null },
        { id: 'thread-2', adminLastReadAt: new Date() },
      ]);
      prisma.meetdayChatMessage.count.mockResolvedValueOnce(3).mockResolvedValueOnce(0);

      const result = await service.countUnreadMeetdayChats();
      expect(result).toBe(1);
    });
  });
});

