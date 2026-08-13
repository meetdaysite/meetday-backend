import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';

// Mock firebase-admin before service instantiation
const mockDeleteUser = jest.fn().mockResolvedValue(undefined);
jest.mock('firebase-admin', () => ({
  auth: () => ({ deleteUser: mockDeleteUser }),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePrisma() {
  const prisma: any = {
    order: { findFirst: jest.fn() },
    user: { findUnique: jest.fn(), update: jest.fn() },
    event: { findFirst: jest.fn() },
    hostPayout: { findFirst: jest.fn() },
    consentRecord: { updateMany: jest.fn() },
  };
  prisma.$transaction = jest.fn().mockResolvedValue(undefined);
  return prisma;
}

const mockAuditLog = { log: jest.fn() };

// ── Fixtures ─────────────────────────────────────────────────────────────────

const userId = 'user-uuid';
const firebaseUid = 'firebase-uid-123';
const dto = { reason: 'No longer using the app' };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('UsersService', () => {
  let service: UsersService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: mockAuditLog },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  describe('deleteSelfAccount', () => {
    it('throws BadRequestException when user has an upcoming confirmed order', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'order-1' });

      await expect(
        service.deleteSelfAccount(userId, firebaseUid, 'USER', dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when HOST has an upcoming published event', async () => {
      prisma.order.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ hostProfile: { id: 'host-profile-1' } });
      prisma.event.findFirst.mockResolvedValue({ id: 'event-1' });
      prisma.hostPayout.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteSelfAccount(userId, firebaseUid, 'HOST', dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when HOST has a pending payout', async () => {
      prisma.order.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ hostProfile: { id: 'host-profile-1' } });
      prisma.event.findFirst.mockResolvedValue(null);
      prisma.hostPayout.findFirst.mockResolvedValue({ id: 'payout-1' });

      await expect(
        service.deleteSelfAccount(userId, firebaseUid, 'HOST', dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('accumulates multiple blockers into one BadRequestException', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'order-1' });
      prisma.user.findUnique.mockResolvedValue({ hostProfile: { id: 'host-profile-1' } });
      prisma.event.findFirst.mockResolvedValue({ id: 'event-1' });
      prisma.hostPayout.findFirst.mockResolvedValue({ id: 'payout-1' });

      const err = await service.deleteSelfAccount(userId, firebaseUid, 'HOST', dto).catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err.getResponse() as any).message).toHaveLength(3);
    });

    it('anonymizes PII, deletes the Firebase user, and logs audit events when no blockers', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      const result = await service.deleteSelfAccount(userId, firebaseUid, 'USER', dto);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(mockDeleteUser).toHaveBeenCalledWith(firebaseUid);
      expect(mockAuditLog.log).toHaveBeenCalledTimes(2);
      expect(result.message).toContain('account has been deleted');
    });

    it('skips HOST checks when role is USER', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await service.deleteSelfAccount(userId, firebaseUid, 'USER', dto);

      // user.findUnique for hostProfile should not be called for a regular USER
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });
});
