import { Test } from '@nestjs/testing';
import { AuditLogService } from './audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePrisma() {
  return {
    auditLog: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  } as any;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AuditLogService', () => {
  let service: AuditLogService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        AuditLogService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(AuditLogService);
  });

  describe('log', () => {
    it('calls prisma.auditLog.create with all provided fields', async () => {
      prisma.auditLog.create.mockResolvedValue({ id: 'log-1' });

      service.log({
        actorId: 'user-1',
        actorRole: 'USER',
        action: 'USER_DELETED' as any,
        entityType: 'USER',
        entityId: 'user-1',
        ipAddress: '127.0.0.1',
        userAgent: 'Jest',
        metadata: { reason: 'test' },
      });

      // log() is fire-and-forget; allow the microtask to flush
      await Promise.resolve();

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorId: 'user-1',
            actorRole: 'USER',
            action: 'USER_DELETED',
            entityType: 'USER',
            entityId: 'user-1',
            ipAddress: '127.0.0.1',
            userAgent: 'Jest',
          }),
        }),
      );
    });

    it('falls back to null for optional fields when omitted', async () => {
      prisma.auditLog.create.mockResolvedValue({ id: 'log-2' });

      service.log({ action: 'REFUND_INITIATED' as any, entityType: 'ORDER', entityId: 'order-1' });

      await Promise.resolve();

      const data = prisma.auditLog.create.mock.calls[0][0].data;
      expect(data.actorId).toBeNull();
      expect(data.ipAddress).toBeNull();
      expect(data.metadata).toBeUndefined();
    });

    it('does not throw when prisma.auditLog.create rejects (swallows error)', async () => {
      prisma.auditLog.create.mockRejectedValue(new Error('DB error'));

      // Should not throw synchronously or propagate
      expect(() =>
        service.log({ action: 'USER_DELETED' as any, entityType: 'USER', entityId: 'x' }),
      ).not.toThrow();

      // Allow the rejection to be handled
      await new Promise((r) => setImmediate(r));
    });
  });

  describe('queryLogs', () => {
    const baseLogs = [{ id: 'log-1', actor: null }];

    it('returns paginated audit log results', async () => {
      prisma.auditLog.findMany.mockResolvedValue(baseLogs);
      prisma.auditLog.count.mockResolvedValue(1);

      const result = await service.queryLogs({ page: 1, limit: 10 });

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
    });

    it('defaults to page 1 limit 50 when not provided', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      await service.queryLogs({});

      const call = prisma.auditLog.findMany.mock.calls[0][0];
      expect(call.skip).toBe(0);
      expect(call.take).toBe(50);
    });

    it('applies actorId filter when provided', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      await service.queryLogs({ actorId: 'actor-1' });

      const where = prisma.auditLog.findMany.mock.calls[0][0].where;
      expect(where.actorId).toBe('actor-1');
    });

    it('applies date range filter when from/to are provided', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      await service.queryLogs({ from: '2025-01-01', to: '2025-12-31' });

      const where = prisma.auditLog.findMany.mock.calls[0][0].where;
      expect(where.createdAt.gte).toEqual(new Date('2025-01-01'));
      expect(where.createdAt.lte).toEqual(new Date('2025-12-31'));
    });

    it('applies all optional filters together', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      await service.queryLogs({
        actorId: 'a1',
        entityType: 'USER',
        entityId: 'u1',
        action: 'USER_DELETED' as any,
      });

      const where = prisma.auditLog.findMany.mock.calls[0][0].where;
      expect(where.actorId).toBe('a1');
      expect(where.entityType).toBe('USER');
      expect(where.entityId).toBe('u1');
      expect(where.action).toBe('USER_DELETED');
    });
  });
});
