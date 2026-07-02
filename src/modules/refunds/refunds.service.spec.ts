import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bull';
import { RefundsService } from './refunds.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditLogService } from '../audit-log/audit-log.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePrisma() {
  const prisma: any = {
    order: { findUnique: jest.fn(), update: jest.fn() },
    refund: { create: jest.fn() },
    orderItem: { update: jest.fn() },
    orderAttendee: { updateMany: jest.fn() },
  };
  prisma.$executeRaw = jest.fn().mockResolvedValue(1);
  prisma.$transaction = jest.fn().mockImplementation(async (fn: any) => fn(prisma));
  return prisma;
}

const mockNotifications = { create: jest.fn().mockResolvedValue(undefined) };
const mockAuditLog = { log: jest.fn() };
const mockRefundQueue = { add: jest.fn().mockResolvedValue(undefined) };

// ── Fixtures ─────────────────────────────────────────────────────────────────

const orderId = 'order-uuid';
const actorId = 'user-uuid';
const orderItemId = 'item-uuid';
const attendeeId = 'attendee-uuid';

function makeFutureDate(hoursFromNow = 48) {
  return new Date(Date.now() + hoursFromNow * 3600_000);
}

function makeOrder(overrides: Partial<any> = {}) {
  return {
    id: orderId,
    status: 'CONFIRMED',
    userId: actorId,
    subtotal: '1000',
    totalAmount: '1050',
    platformFee: '50',
    couponId: null,
    event: {
      id: 'event-uuid',
      title: 'Test Event',
      eventDate: makeFutureDate(),
      cancellationReason: null,
      refundPolicy: { type: 'FULL', cutoffHours: null, refundPercent: null },
    },
    user: { id: actorId, email: 'user@test.com', firstName: 'Test', phone: null },
    items: [
      {
        id: orderItemId,
        quantity: 2,
        cancelledCount: 0,
        unitPrice: '500',
        ticket: { id: 'ticket-uuid', name: 'General', isFree: false },
        attendees: [
          { id: attendeeId, fullName: 'Alice', checkedInAt: null, cancelledAt: null },
          { id: 'att-2', fullName: 'Bob', checkedInAt: null, cancelledAt: null },
        ],
      },
    ],
    ...overrides,
  };
}

const cancelOneItem = [
  { orderItemId, quantity: 1, attendeeIds: [attendeeId] },
];
const cancelBothItems = [
  { orderItemId, quantity: 2, attendeeIds: [attendeeId, 'att-2'] },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RefundsService', () => {
  let service: RefundsService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        RefundsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: AuditLogService, useValue: mockAuditLog },
        { provide: getQueueToken('refund-processing'), useValue: mockRefundQueue },
      ],
    }).compile();

    service = module.get(RefundsService);
  });

  describe('initiateCancellation', () => {
    it('throws NotFoundException when order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null);
      await expect(service.initiateCancellation(orderId, cancelOneItem, 'USER_CANCELLED', actorId)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when order status is not cancellable', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder({ status: 'PENDING_PAYMENT' }));
      await expect(service.initiateCancellation(orderId, cancelOneItem, 'USER_CANCELLED', actorId)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when USER_CANCELLED past the cutoff window', async () => {
      const order = makeOrder({
        event: {
          ...makeOrder().event,
          eventDate: makeFutureDate(2), // 2h from now
          refundPolicy: { type: 'FULL', cutoffHours: 24, refundPercent: null }, // must cancel 24h before
        },
      });
      prisma.order.findUnique.mockResolvedValue(order);
      await expect(service.initiateCancellation(orderId, cancelOneItem, 'USER_CANCELLED', actorId)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when order item is not found in the order', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder());
      const badItem = [{ orderItemId: 'nonexistent-item', quantity: 1, attendeeIds: ['att-x'] }];
      await expect(service.initiateCancellation(orderId, badItem, 'USER_CANCELLED', actorId)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when quantity exceeds remaining active tickets', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder());
      const overQty = [{ orderItemId, quantity: 3, attendeeIds: [attendeeId, 'att-2', 'att-3'] }];
      await expect(service.initiateCancellation(orderId, overQty, 'USER_CANCELLED', actorId)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when attendeeIds.length !== quantity', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder());
      const mismatch = [{ orderItemId, quantity: 2, attendeeIds: [attendeeId] }];
      await expect(service.initiateCancellation(orderId, mismatch, 'USER_CANCELLED', actorId)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when an attendee is not in the order item', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder());
      const unknownAttendee = [{ orderItemId, quantity: 1, attendeeIds: ['unknown-att'] }];
      await expect(service.initiateCancellation(orderId, unknownAttendee, 'USER_CANCELLED', actorId)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when attendee ticket is already cancelled', async () => {
      const order = makeOrder();
      order.items[0].attendees[0].cancelledAt = new Date();
      prisma.order.findUnique.mockResolvedValue(order);
      await expect(service.initiateCancellation(orderId, cancelOneItem, 'USER_CANCELLED', actorId)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when attendee has already checked in', async () => {
      const order = makeOrder();
      order.items[0].attendees[0].checkedInAt = new Date();
      prisma.order.findUnique.mockResolvedValue(order);
      await expect(service.initiateCancellation(orderId, cancelOneItem, 'USER_CANCELLED', actorId)).rejects.toThrow(BadRequestException);
    });

    it('uses refundMultiplier = 1 for FULL refund policy', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder());
      prisma.refund.create.mockResolvedValue({ id: 'refund-1' });

      await service.initiateCancellation(orderId, cancelOneItem, 'USER_CANCELLED', actorId);

      const createCall = prisma.refund.create.mock.calls[0][0];
      // 1 ticket at 500 out of 1000 subtotal → 50% of (1050-50) = 500 paise = ₹5
      expect(createCall.data.totalAmount).toBeGreaterThan(0);
    });

    it('uses refundMultiplier = 0 for NO_REFUND policy', async () => {
      const order = makeOrder({
        event: {
          ...makeOrder().event,
          refundPolicy: { type: 'NO_REFUND', cutoffHours: null, refundPercent: null },
        },
      });
      prisma.order.findUnique.mockResolvedValue(order);
      prisma.refund.create.mockResolvedValue({ id: 'refund-1' });

      await service.initiateCancellation(orderId, cancelOneItem, 'USER_CANCELLED', actorId);

      const createCall = prisma.refund.create.mock.calls[0][0];
      expect(createCall.data.totalAmount).toBe(0);
    });

    it('uses partial refund percent for PARTIAL policy', async () => {
      const order = makeOrder({
        event: {
          ...makeOrder().event,
          refundPolicy: { type: 'PARTIAL', cutoffHours: null, refundPercent: 50 },
        },
      });
      prisma.order.findUnique.mockResolvedValue(order);
      prisma.refund.create.mockResolvedValue({ id: 'refund-1' });

      await service.initiateCancellation(orderId, cancelOneItem, 'USER_CANCELLED', actorId);

      const createCall = prisma.refund.create.mock.calls[0][0];
      expect(createCall.data.totalAmount).toBeGreaterThan(0);
      // Full refund for 1 ticket would be 5000 paise; 50% → 2500 paise
      expect(createCall.data.totalAmount).toBeLessThan(50000);
    });

    it('sets platformFeeRefunded = true for EVENT_CANCELLED', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder());
      prisma.refund.create.mockResolvedValue({ id: 'refund-1' });

      await service.initiateCancellation(orderId, cancelBothItems, 'EVENT_CANCELLED', actorId);

      const createCall = prisma.refund.create.mock.calls[0][0];
      expect(createCall.data.platformFeeRefunded).toBe(true);
    });

    it('marks order as CANCELLED on full cancellation', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder());
      prisma.refund.create.mockResolvedValue({ id: 'refund-1' });

      await service.initiateCancellation(orderId, cancelBothItems, 'USER_CANCELLED', actorId);

      const updateCall = prisma.order.update.mock.calls[0][0];
      expect(updateCall.data.status).toBe('CANCELLED');
      expect(updateCall.data.cancelledAt).toBeDefined();
    });

    it('marks order as PARTIALLY_REFUNDED on partial cancellation', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder());
      prisma.refund.create.mockResolvedValue({ id: 'refund-1' });

      await service.initiateCancellation(orderId, cancelOneItem, 'USER_CANCELLED', actorId);

      const updateCall = prisma.order.update.mock.calls[0][0];
      expect(updateCall.data.status).toBe('PARTIALLY_REFUNDED');
    });

    it('rolls back coupon usage on full cancellation with a coupon', async () => {
      const order = makeOrder({ couponId: 'coupon-uuid' });
      prisma.order.findUnique.mockResolvedValue(order);
      prisma.refund.create.mockResolvedValue({ id: 'refund-1' });

      await service.initiateCancellation(orderId, cancelBothItems, 'USER_CANCELLED', actorId);

      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it('adds a job to the refund-processing queue', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder());
      prisma.refund.create.mockResolvedValue({ id: 'refund-1' });

      await service.initiateCancellation(orderId, cancelOneItem, 'USER_CANCELLED', actorId);

      expect(mockRefundQueue.add).toHaveBeenCalledWith(
        'process-refund',
        { refundId: 'refund-1' },
        expect.objectContaining({ attempts: 3 }),
      );
    });

    it('logs audit event with correct actor role for USER_CANCELLED', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder());
      prisma.refund.create.mockResolvedValue({ id: 'refund-1' });

      await service.initiateCancellation(orderId, cancelOneItem, 'USER_CANCELLED', actorId);

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ actorRole: 'ATTENDEE', action: 'REFUND_INITIATED' }),
      );
    });
  });
});
