import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AdminDashboardService } from './admin-dashboard.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePrisma() {
  const prisma: any = {
    hostProfile: { count: jest.fn().mockResolvedValue(0), findUnique: jest.fn() },
    event: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
    communityMember: { count: jest.fn().mockResolvedValue(0) },
    communityPostReport: { count: jest.fn().mockResolvedValue(0) },
    channelMessageReport: { count: jest.fn().mockResolvedValue(0) },
    supportTicket: { count: jest.fn().mockResolvedValue(0) },
    order: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { totalAmount: null } }),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
    },
    user: { count: jest.fn().mockResolvedValue(0) },
    hostPayout: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { totalAmount: null, netPayoutAmount: null } }),
      count: jest.fn().mockResolvedValue(0),
    },
    auditLog: { findMany: jest.fn().mockResolvedValue([]) },
  };
  prisma.$transaction = jest.fn().mockImplementation(async (ops: any[]) => Promise.all(ops));
  prisma.$queryRaw = jest.fn().mockResolvedValue([]);
  return prisma;
}

const mockRedis = { get: jest.fn(), set: jest.fn() };
const mockConfig = { get: jest.fn() };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AdminDashboardService', () => {
  let service: AdminDashboardService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        AdminDashboardService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: mockRedis },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get(AdminDashboardService);
  });

  describe('getStats', () => {
    it('returns cached stats without hitting the DB on cache hit', async () => {
      const cached = { hostApprovals: 3, eventApprovals: 1 };
      mockRedis.get.mockResolvedValue(cached);

      const result = await service.getStats();

      expect(result).toEqual(cached);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('queries the DB and caches result on cache miss', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.set.mockResolvedValue(undefined);

      const result = await service.getStats();

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(mockRedis.set).toHaveBeenCalledWith('admin:dashboard:stats', expect.anything(), expect.any(Number));
      expect(result).toBeDefined();
    });

    it('includes zero counts when no activity has occurred', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.set.mockResolvedValue(undefined);

      const result = (await service.getStats()) as any;

      expect(result).toMatchObject({
        pendingReviews: 0,
        liveEvents: 0,
        supportFlags: 0,
        revenueToday: 0,
      });
    });
  });

  describe('getRecentActivity', () => {
    it('falls back to the actor\'s name when the host has not set a displayName yet', async () => {
      mockRedis.get.mockResolvedValue(null);
      prisma.auditLog.findMany.mockResolvedValue([
        {
          id: 'log-1',
          action: 'KYC_SUBMITTED',
          entityType: 'HOST',
          entityId: 'host-1',
          actor: { firstName: 'New', lastName: 'Host 3' },
          createdAt: new Date(),
        },
      ]);
      prisma.hostProfile.findUnique.mockResolvedValue({ displayName: null, operatingCities: ['Kolkata'] });

      const result: any = await service.getRecentActivity();

      expect(result.items[0].label).toBe('New host application by New Host 3');
      expect(result.items[0].label).not.toContain('null');
    });

    it('uses the host displayName once it has been set', async () => {
      mockRedis.get.mockResolvedValue(null);
      prisma.auditLog.findMany.mockResolvedValue([
        {
          id: 'log-2',
          action: 'KYC_APPROVED',
          entityType: 'HOST',
          entityId: 'host-1',
          actor: { firstName: 'Aishik', lastName: 'Sikdar' },
          createdAt: new Date(),
        },
      ]);
      prisma.hostProfile.findUnique.mockResolvedValue({ displayName: "Adrita's Experiences", operatingCities: ['Kolkata'] });

      const result: any = await service.getRecentActivity();

      expect(result.items[0].label).toBe("New host application by Adrita's Experiences");
    });

    it('labels REFUND_COMPLETED distinctly from ORDER_CONFIRMED', async () => {
      mockRedis.get.mockResolvedValue(null);
      prisma.auditLog.findMany.mockResolvedValue([
        {
          id: 'log-3',
          action: 'REFUND_COMPLETED',
          entityType: 'ORDER',
          entityId: 'order-1',
          actor: null,
          createdAt: new Date(),
        },
        {
          id: 'log-4',
          action: 'ORDER_CONFIRMED',
          entityType: 'ORDER',
          entityId: 'order-1',
          actor: null,
          createdAt: new Date(),
        },
      ]);
      prisma.order.findUnique.mockResolvedValue({ bookingId: 'MDAY-E641-AE4E' });

      const result: any = await service.getRecentActivity();

      expect(result.items[0].label).toBe('Refund completed for order MDAY-E641-AE4E');
      expect(result.items[1].label).toBe('Order MDAY-E641-AE4E confirmed');
    });
  });

  describe('getRevenue', () => {
    it('returns cached revenue without hitting the DB on cache hit', async () => {
      const cached = { current: 5000, previous: 4000 };
      mockRedis.get.mockResolvedValue(cached);

      const result = await service.getRevenue({ period: 'TODAY' as any });

      expect(result).toEqual(cached);
      expect(prisma.order.aggregate).not.toHaveBeenCalled();
    });

    it('computes revenue from the DB on cache miss', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.set.mockResolvedValue(undefined);
      prisma.order.aggregate
        .mockResolvedValueOnce({ _sum: { totalAmount: '10000' } }) // current period
        .mockResolvedValueOnce({ _sum: { totalAmount: '8000' } }); // previous period

      const result = await service.getRevenue({ period: 'TODAY' as any });

      expect(result).toBeDefined();
      expect(mockRedis.set).toHaveBeenCalled();
    });
  });
});
