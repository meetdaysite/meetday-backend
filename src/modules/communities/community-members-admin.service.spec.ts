import { Test } from '@nestjs/testing';
import { CommunityMembersAdminService } from './community-members-admin.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { StorageService } from '../../common/storage/storage.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePrisma() {
  return {
    community: { findUnique: jest.fn() },
    communityMember: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
  } as any;
}

const mockRedis = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
const mockStorage = { getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://cdn.test/avatar.jpg') };
const mockAuditLog = { log: jest.fn() };
const mockNotifications = { create: jest.fn().mockResolvedValue(undefined) };

// ── Fixtures ─────────────────────────────────────────────────────────────────

const communityId = 'community-uuid';
const adminId = 'admin-uuid';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CommunityMembersAdminService', () => {
  let service: CommunityMembersAdminService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        CommunityMembersAdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: mockRedis },
        { provide: StorageService, useValue: mockStorage },
        { provide: AuditLogService, useValue: mockAuditLog },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get(CommunityMembersAdminService);
  });

  describe('getMemberStats', () => {
    it('returns cached stats without querying the DB', async () => {
      const cachedStats = { totalMembers: 42 };
      mockRedis.get.mockResolvedValue(cachedStats);

      const result = await service.getMemberStats(communityId);

      expect(result).toEqual(cachedStats);
      expect(prisma.community.findUnique).not.toHaveBeenCalled();
    });

    it('queries the DB and caches result on cache miss', async () => {
      mockRedis.get.mockResolvedValue(null);
      prisma.community.findUnique.mockResolvedValue({ memberCount: 100 });
      // All count queries return 0 for simplicity
      prisma.communityMember.count.mockResolvedValue(0);

      const result = await service.getMemberStats(communityId);

      expect(prisma.community.findUnique).toHaveBeenCalled();
      expect(mockRedis.set).toHaveBeenCalledWith(
        `admin:member-stats:${communityId}`,
        expect.anything(),
        expect.any(Number),
      );
      expect(result).toBeDefined();
    });
  });
});
