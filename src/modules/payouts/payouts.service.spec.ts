import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bull';
import { createHmac } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PayoutsService } from './payouts.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';

// Mock Razorpay before import
const mockRzpPayoutsCreate = jest.fn();
jest.mock('razorpay', () =>
  jest.fn().mockImplementation(() => ({
    payouts: { create: mockRzpPayoutsCreate },
  })),
);

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePrisma() {
  const prisma: any = {
    event: { findUnique: jest.fn() },
    hostPayout: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      aggregate: jest.fn(),
      groupBy: jest.fn(),
    },
    hostPayoutHistory: { create: jest.fn() },
    hostPayoutLineItem: { findMany: jest.fn() },
    order: { findMany: jest.fn() },
  };
  prisma.$transaction = jest.fn().mockImplementation(async (ops: any) => {
    if (Array.isArray(ops)) return Promise.all(ops);
    return ops(prisma);
  });
  return prisma;
}

const WEBHOOK_SECRET = 'webhook_secret_123';
const mockConfig = {
  get: jest.fn((key: string) => {
    if (key === 'razorpay.keyId') return 'rzp_key';
    if (key === 'razorpay.keySecret') return 'rzp_secret';
    if (key === 'razorpay.xAccountNumber') return 'XACC123';
    if (key === 'razorpay.payoutWebhookSecret') return WEBHOOK_SECRET;
    if (key === 'payout.holdDays') return 7;
    if (key === 'payout.tdsRate') return 0.01;
    if (key === 'payout.minPayoutAmount') return 100;
    return undefined;
  }),
};
const mockAuditLog = { log: jest.fn() };
const mockNotifications = { create: jest.fn().mockResolvedValue(undefined) };
const mockMailQueue = { add: jest.fn().mockResolvedValue(undefined) };

// ── Fixtures ─────────────────────────────────────────────────────────────────

const eventId = 'event-uuid';
const hostId = 'host-profile-uuid';
const payoutId = 'payout-uuid';
const adminId = 'admin-uuid';

function makeEvent(overrides: Partial<any> = {}) {
  return {
    id: eventId,
    title: 'Test Concert',
    eventDate: new Date(Date.now() - 10 * 24 * 3600_000), // 10 days ago (past holdDays=7)
    hostProfileId: hostId,
    hostProfile: {
      id: hostId,
      payoutAccount: {
        status: 'APPROVED',
        razorpayFundAccountId: 'fa_123',
      },
    },
    ...overrides,
  };
}

function makePayout(status = 'PENDING', overrides: Partial<any> = {}) {
  return {
    id: payoutId,
    status,
    hostId,
    eventId,
    netPayoutAmount: '500',
    razorpayFundAccountId: 'fa_123',
    payoutMode: 'IMPS',
    razorpayPayoutId: null,
    holdReason: null,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PayoutsService', () => {
  let service: PayoutsService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        PayoutsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: mockConfig },
        { provide: AuditLogService, useValue: mockAuditLog },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: getQueueToken('mail'), useValue: mockMailQueue },
      ],
    }).compile();

    service = module.get(PayoutsService);
  });

  // ── computeAndCreatePayout ────────────────────────────────────────────────

  describe('computeAndCreatePayout', () => {
    it('throws NotFoundException when event does not exist', async () => {
      prisma.event.findUnique.mockResolvedValue(null);
      await expect(service.computeAndCreatePayout(eventId)).rejects.toThrow(NotFoundException);
    });

    it('returns null when event has no eventDate', async () => {
      prisma.event.findUnique.mockResolvedValue({ ...makeEvent(), eventDate: null });
      const result = await service.computeAndCreatePayout(eventId);
      expect(result).toBeNull();
    });

    it('returns null when hold period has not elapsed', async () => {
      prisma.event.findUnique.mockResolvedValue(makeEvent({ eventDate: new Date(Date.now() - 1 * 24 * 3600_000) }));
      const result = await service.computeAndCreatePayout(eventId);
      expect(result).toBeNull();
    });

    it('returns null when payout account is not APPROVED', async () => {
      prisma.event.findUnique.mockResolvedValue(makeEvent({ hostProfile: { id: hostId, payoutAccount: { status: 'PENDING', razorpayFundAccountId: 'fa_123' } } }));
      const result = await service.computeAndCreatePayout(eventId);
      expect(result).toBeNull();
    });

    it('returns null when host has no razorpayFundAccountId', async () => {
      prisma.event.findUnique.mockResolvedValue(makeEvent({ hostProfile: { id: hostId, payoutAccount: { status: 'APPROVED', razorpayFundAccountId: null } } }));
      const result = await service.computeAndCreatePayout(eventId);
      expect(result).toBeNull();
    });

    it('returns existing payout for idempotency', async () => {
      prisma.event.findUnique.mockResolvedValue(makeEvent());
      prisma.hostPayout.findUnique.mockResolvedValue(makePayout());

      const result = await service.computeAndCreatePayout(eventId);

      expect(prisma.hostPayout.create).not.toHaveBeenCalled();
      expect(result).toMatchObject({ id: payoutId });
    });

    it('returns null when there are no unpaid confirmed orders', async () => {
      prisma.event.findUnique.mockResolvedValue(makeEvent());
      prisma.hostPayout.findUnique.mockResolvedValue(null);
      prisma.order.findMany.mockResolvedValue([]);

      const result = await service.computeAndCreatePayout(eventId);
      expect(result).toBeNull();
    });

    it('returns null when net payout is below minimum', async () => {
      prisma.event.findUnique.mockResolvedValue(makeEvent());
      prisma.hostPayout.findUnique.mockResolvedValue(null);
      prisma.order.findMany.mockResolvedValue([
        { id: 'o1', subtotal: '10', discountAmount: '0', platformFee: '1' },
      ]);

      const result = await service.computeAndCreatePayout(eventId);
      expect(result).toBeNull();
    });

    it('creates a payout with correct TDS deduction', async () => {
      prisma.event.findUnique.mockResolvedValue(makeEvent());
      prisma.hostPayout.findUnique.mockResolvedValue(null);
      prisma.order.findMany.mockResolvedValue([
        { id: 'o1', subtotal: '10000', discountAmount: '0', platformFee: '500' },
      ]);
      const created = makePayout('PENDING', { netPayoutAmount: '9405' });
      prisma.hostPayout.create.mockResolvedValue(created);

      const result = await service.computeAndCreatePayout(eventId);

      expect(prisma.hostPayout.create).toHaveBeenCalled();
      const createData = prisma.hostPayout.create.mock.calls[0][0].data;
      // hostGross = 10000 - 500 = 9500; tds = 9500 * 0.01 = 95; net = 9405
      expect(Number(createData.tdsAmount)).toBeCloseTo(95, 0);
      expect(Number(createData.netPayoutAmount)).toBeCloseTo(9405, 0);
      expect(result).toMatchObject({ id: payoutId });
    });
  });

  // ── triggerPayout ─────────────────────────────────────────────────────────

  describe('triggerPayout', () => {
    it('throws NotFoundException when payout does not exist', async () => {
      prisma.hostPayout.findUnique.mockResolvedValue(null);
      await expect(service.triggerPayout(payoutId)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when payout is not PENDING', async () => {
      prisma.hostPayout.findUnique.mockResolvedValue(makePayout('PROCESSING'));
      await expect(service.triggerPayout(payoutId)).rejects.toThrow(BadRequestException);
    });

    it('skips live trigger when xAccountNumber is not configured', async () => {
      const configWithoutX = { get: jest.fn((k: string) => k === 'razorpay.xAccountNumber' ? undefined : mockConfig.get(k)) };
      const module = await Test.createTestingModule({
        providers: [
          PayoutsService,
          { provide: PrismaService, useValue: prisma },
          { provide: ConfigService, useValue: configWithoutX },
          { provide: AuditLogService, useValue: mockAuditLog },
          { provide: NotificationsService, useValue: mockNotifications },
          { provide: getQueueToken('mail'), useValue: mockMailQueue },
        ],
      }).compile();
      const svc = module.get(PayoutsService);

      prisma.hostPayout.findUnique.mockResolvedValue(makePayout());
      const result = await svc.triggerPayout(payoutId);

      expect(mockRzpPayoutsCreate).not.toHaveBeenCalled();
      expect(result).toMatchObject({ id: payoutId });
    });

    it('creates Razorpay payout and updates status to PROCESSING', async () => {
      prisma.hostPayout.findUnique.mockResolvedValue({ ...makePayout(), event: { title: 'Test Concert' } });
      mockRzpPayoutsCreate.mockResolvedValue({ id: 'rzp_payout_123' });
      prisma.hostPayout.update.mockResolvedValue({
        ...makePayout(),
        status: 'PROCESSING',
        razorpayPayoutId: 'rzp_payout_123',
      });

      const result = await service.triggerPayout(payoutId);

      expect(mockRzpPayoutsCreate).toHaveBeenCalledWith(expect.objectContaining({ reference_id: payoutId }));
      expect(prisma.$transaction).toHaveBeenCalled();
      // Returns the rupee-denominated HostPayout record, not the raw paise-denominated Razorpay payout object
      expect(result).toMatchObject({ id: payoutId, status: 'PROCESSING', razorpayPayoutId: 'rzp_payout_123' });
    });
  });

  // ── handlePayoutWebhook ───────────────────────────────────────────────────

  describe('handlePayoutWebhook', () => {
    function makeWebhookBody(event: string) {
      return {
        event,
        payload: {
          payout: {
            entity: { id: 'rzp_payout_123', reference_id: payoutId, failure_reason: null },
          },
        },
      };
    }

    function makeSignature(rawBody: Buffer) {
      return createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
    }

    it('throws UnauthorizedException on invalid signature', () => {
      const raw = Buffer.from(JSON.stringify(makeWebhookBody('payout.processed')));
      expect(() => service.handlePayoutWebhook(raw, 'bad_sig', makeWebhookBody('payout.processed') as any)).toThrow(UnauthorizedException);
    });

    it('does not throw synchronously (fire-and-forget processing)', () => {
      const dto = makeWebhookBody('payout.processed') as any;
      const raw = Buffer.from(JSON.stringify(dto));
      const sig = makeSignature(raw);

      prisma.hostPayout.findFirst.mockResolvedValue(makePayout('PROCESSING', { razorpayPayoutId: 'rzp_payout_123' }));
      // Return null so notifyHostPayoutCompleted returns early without accessing nested host.user
      prisma.hostPayout.findUnique.mockResolvedValue(null);

      // The function returns void synchronously and processes the webhook as a fire-and-forget promise
      expect(() => service.handlePayoutWebhook(raw, sig, dto)).not.toThrow();
    });
  });

  // ── holdPayout ────────────────────────────────────────────────────────────

  describe('holdPayout', () => {
    it('throws NotFoundException when payout does not exist', async () => {
      prisma.hostPayout.findUnique.mockResolvedValue(null);
      await expect(service.holdPayout(payoutId, 'Fraud review', adminId)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when payout is already COMPLETED', async () => {
      prisma.hostPayout.findUnique.mockResolvedValue(makePayout('COMPLETED'));
      await expect(service.holdPayout(payoutId, 'Fraud review', adminId)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when payout is already REVERSED', async () => {
      prisma.hostPayout.findUnique.mockResolvedValue(makePayout('REVERSED'));
      await expect(service.holdPayout(payoutId, 'Fraud review', adminId)).rejects.toThrow(BadRequestException);
    });

    it('places a PENDING payout on hold and logs audit', async () => {
      prisma.hostPayout.findUnique.mockResolvedValue(makePayout('PENDING'));

      const result = await service.holdPayout(payoutId, 'Fraud review', adminId);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(mockAuditLog.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'PAYOUT_HELD' }));
      expect(result.message).toBeDefined();
    });
  });

  // ── releasePayout ─────────────────────────────────────────────────────────

  describe('releasePayout', () => {
    it('throws BadRequestException when payout is not ON_HOLD', async () => {
      prisma.hostPayout.findUnique.mockResolvedValue(makePayout('PENDING'));
      await expect(service.releasePayout(payoutId, adminId)).rejects.toThrow(BadRequestException);
    });

    it('releases an ON_HOLD payout back to PENDING', async () => {
      prisma.hostPayout.findUnique.mockResolvedValue(makePayout('ON_HOLD'));

      const result = await service.releasePayout(payoutId, adminId);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result.message).toBeDefined();
    });
  });

  // ── retryPayout ───────────────────────────────────────────────────────────

  describe('retryPayout', () => {
    it('throws BadRequestException when payout is not FAILED', async () => {
      prisma.hostPayout.findUnique.mockResolvedValue(makePayout('PENDING'));
      await expect(service.retryPayout(payoutId, adminId)).rejects.toThrow(BadRequestException);
    });

    it('resets a FAILED payout and triggers a new Razorpay payout', async () => {
      prisma.hostPayout.findUnique.mockResolvedValue(makePayout('FAILED'));
      mockRzpPayoutsCreate.mockResolvedValue({ id: 'rzp_retry_123' });

      // Second findUnique call (from triggerPayout) returns the reset payout
      prisma.hostPayout.findUnique
        .mockResolvedValueOnce(makePayout('FAILED'))
        .mockResolvedValueOnce({ ...makePayout('PENDING'), event: { title: 'Test Concert' } });

      await service.retryPayout(payoutId, adminId);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(mockRzpPayoutsCreate).toHaveBeenCalled();
    });
  });

  // ── getHostPayoutById ─────────────────────────────────────────────────────

  describe('getHostPayoutById', () => {
    it('throws NotFoundException when payout does not exist', async () => {
      prisma.hostPayout.findUnique.mockResolvedValue(null);
      await expect(service.getHostPayoutById(payoutId, hostId)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when payout belongs to a different host', async () => {
      prisma.hostPayout.findUnique.mockResolvedValue(makePayout('PENDING', { hostId: 'other-host' }));
      await expect(service.getHostPayoutById(payoutId, hostId)).rejects.toThrow(BadRequestException);
    });

    it('returns payout when host matches', async () => {
      const payout = makePayout('COMPLETED', { lineItems: [], history: [] });
      prisma.hostPayout.findUnique.mockResolvedValue(payout);

      const result = await service.getHostPayoutById(payoutId, hostId);
      expect(result).toMatchObject({ id: payoutId });
    });
  });

  // ── getTdsSummary ─────────────────────────────────────────────────────────

  describe('getTdsSummary', () => {
    it('throws BadRequestException for invalid financial year format', async () => {
      await expect(service.getTdsSummary('2025')).rejects.toThrow(BadRequestException);
    });

    it('calls groupBy with correct date range for a valid financial year', async () => {
      prisma.hostPayout.groupBy.mockResolvedValue([]);

      await service.getTdsSummary('2025-26');

      expect(prisma.hostPayout.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            completedAt: expect.objectContaining({
              gte: new Date('2025-04-01T00:00:00.000Z'),
              lte: new Date('2026-03-31T23:59:59.999Z'),
            }),
          }),
        }),
      );
    });
  });
});
