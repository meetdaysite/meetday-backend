import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ConsentService } from './consent.service';
import { PrismaService } from '../../prisma/prisma.service';

function makePrisma() {
  const prisma: any = {
    consentRecord: {
      updateMany: jest.fn().mockResolvedValue({}),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
  };
  return prisma;
}

const userId = 'user-uuid';
const consentType = 'HOST_KYC_DATA_SHARING' as any;

describe('ConsentService', () => {
  let service: ConsentService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();

    const module = await Test.createTestingModule({
      providers: [
        ConsentService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(ConsentService);
    jest.clearAllMocks();
  });

  // ── grantConsent() ────────────────────────────────────────────────────────

  describe('grantConsent()', () => {
    it('deactivates existing active records then creates a new one', async () => {
      const created = { id: 'rec-1', userId, consentType, isActive: true };
      prisma.consentRecord.create.mockResolvedValue(created);

      const result = await service.grantConsent({ userId, consentType });

      expect(prisma.consentRecord.updateMany).toHaveBeenCalledWith({
        where: { userId, consentType, isActive: true },
        data: expect.objectContaining({ isActive: false }),
      });
      expect(prisma.consentRecord.create).toHaveBeenCalled();
      expect(result).toEqual(created);
    });

    it('stores optional ipAddress and userAgent when provided', async () => {
      prisma.consentRecord.create.mockResolvedValue({ id: 'rec-2' });

      await service.grantConsent({
        userId,
        consentType,
        ipAddress: '1.2.3.4',
        userAgent: 'Mozilla/5',
      });

      expect(prisma.consentRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ipAddress: '1.2.3.4', userAgent: 'Mozilla/5' }),
        }),
      );
    });

    it('stores null for ipAddress and userAgent when omitted', async () => {
      prisma.consentRecord.create.mockResolvedValue({ id: 'rec-3' });

      await service.grantConsent({ userId, consentType });

      expect(prisma.consentRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ipAddress: null, userAgent: null }),
        }),
      );
    });
  });

  // ── withdrawConsent() ─────────────────────────────────────────────────────

  describe('withdrawConsent()', () => {
    it('deactivates an active consent record', async () => {
      prisma.consentRecord.findFirst.mockResolvedValue({ id: 'rec-1' });
      prisma.consentRecord.update.mockResolvedValue({});

      await service.withdrawConsent(userId, consentType);

      expect(prisma.consentRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rec-1' },
          data: expect.objectContaining({ isActive: false }),
        }),
      );
    });

    it('throws NotFoundException when no active consent exists', async () => {
      prisma.consentRecord.findFirst.mockResolvedValue(null);
      await expect(service.withdrawConsent(userId, consentType)).rejects.toThrow(NotFoundException);
    });
  });

  // ── hasActiveConsent() ────────────────────────────────────────────────────

  describe('hasActiveConsent()', () => {
    it('returns true when an active record exists', async () => {
      prisma.consentRecord.findFirst.mockResolvedValue({ id: 'rec-1' });
      expect(await service.hasActiveConsent(userId, consentType)).toBe(true);
    });

    it('returns false when no active record exists', async () => {
      prisma.consentRecord.findFirst.mockResolvedValue(null);
      expect(await service.hasActiveConsent(userId, consentType)).toBe(false);
    });
  });

  // ── getActiveConsents() ───────────────────────────────────────────────────

  describe('getActiveConsents()', () => {
    it('returns all active consent records for the user', async () => {
      const records = [{ id: 'rec-1', consentType, isActive: true }];
      prisma.consentRecord.findMany.mockResolvedValue(records);

      const result = await service.getActiveConsents(userId);
      expect(result).toEqual(records);
      expect(prisma.consentRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId, isActive: true } }),
      );
    });
  });

  // ── getUserConsentHistory() ───────────────────────────────────────────────

  describe('getUserConsentHistory()', () => {
    it('returns full consent history ordered by createdAt desc', async () => {
      const records = [
        { id: 'rec-2', consentType, isActive: true },
        { id: 'rec-1', consentType, isActive: false },
      ];
      prisma.consentRecord.findMany.mockResolvedValue(records);

      const result = await service.getUserConsentHistory(userId);
      expect(result).toHaveLength(2);
      expect(prisma.consentRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId }, orderBy: { createdAt: 'desc' } }),
      );
    });
  });
});
