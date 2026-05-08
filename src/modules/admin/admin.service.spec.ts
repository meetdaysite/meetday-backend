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
    coupon: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    category: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
  };
  prisma.$transaction = jest.fn().mockImplementation(async (fn: any) => fn(prisma));
  return prisma;
}

const mockMailQueue = { add: jest.fn() };
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
        { provide: NotificationsService, useValue: { create: jest.fn() } },
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

    it('throws ConflictException when email already exists in DB', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'existing' });
      await expect(service.inviteAdmin(dto)).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when email already exists in Firebase', async () => {
      mockAuth.getUserByEmail.mockResolvedValue({ uid: 'existing-firebase-uid' });
      await expect(service.inviteAdmin(dto)).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException when trying to grant SUPER_ADMIN', async () => {
      prisma.role.findUnique.mockResolvedValue(superAdminRole);
      await expect(service.inviteAdmin({ ...dto, roleId: superAdminRole.id })).rejects.toThrow(
        BadRequestException,
      );
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
});
