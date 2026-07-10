import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CommunityDmService } from './community-dm.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../../common/storage/storage.service';
import { CryptoService } from '../../common/crypto/crypto.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePrisma() {
  return {
    communitySettings: { findUnique: jest.fn() },
    communityMember: { findFirst: jest.fn() },
    dmConversation: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    dmMessage: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    orderAttendee: { findMany: jest.fn() },
    order: { findFirst: jest.fn() },
  } as any;
}

const mockNotifications = { create: jest.fn().mockResolvedValue(undefined) };
const mockStorage = { getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://cdn.test/img.jpg') };
const mockCrypto = {
  encrypt: jest.fn((text: string) => `enc:${text}`),
  decrypt: jest.fn((text: string) => text.replace('enc:', '')),
};

// ── Fixtures ─────────────────────────────────────────────────────────────────

const communityId = 'community-uuid';
const userId = 'user-uuid';
const targetUserId = 'target-uuid';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CommunityDmService', () => {
  let service: CommunityDmService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        CommunityDmService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: StorageService, useValue: mockStorage },
        { provide: CryptoService, useValue: mockCrypto },
      ],
    }).compile();

    service = module.get(CommunityDmService);
  });

  describe('checkDmPolicy', () => {
    it('throws ForbiddenException when community DM policy is DISABLED', async () => {
      prisma.communitySettings.findUnique.mockResolvedValue({ dmPolicy: 'DISABLED' });

      await expect(service.checkDmPolicy(communityId, userId, targetUserId)).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when community has no settings (defaults to DISABLED)', async () => {
      prisma.communitySettings.findUnique.mockResolvedValue(null);

      await expect(service.checkDmPolicy(communityId, userId, targetUserId)).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when MUTUAL_ATTENDEES_ONLY and users share no events', async () => {
      prisma.communitySettings.findUnique.mockResolvedValue({ dmPolicy: 'MUTUAL_ATTENDEES_ONLY' });
      prisma.orderAttendee.findMany.mockResolvedValue([]);

      await expect(service.checkDmPolicy(communityId, userId, targetUserId)).rejects.toThrow(ForbiddenException);
    });

    it('passes for MEMBERS_ONLY policy', async () => {
      prisma.communitySettings.findUnique.mockResolvedValue({ dmPolicy: 'MEMBERS_ONLY' });

      await expect(service.checkDmPolicy(communityId, userId, targetUserId)).resolves.not.toThrow();
    });
  });
});
