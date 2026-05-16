import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getQueueToken } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import { OrdersService } from './orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { EventsVibeService } from '../events/events-vibe.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePrisma() {
  const prisma: any = {
    user: { findUnique: jest.fn() },
    event: { findUnique: jest.fn() },
    eventTicket: { findMany: jest.fn(), findUnique: jest.fn() },
    orderItem: { aggregate: jest.fn() },
    coupon: { findUnique: jest.fn() },
    order: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    subscriptionPlan: { findUnique: jest.fn() },
  };
  prisma.$executeRaw = jest.fn().mockResolvedValue(1);
  prisma.$transaction = jest.fn().mockImplementation(async (fn: any) => fn(prisma));
  return prisma;
}

const mockNotifications = { create: jest.fn().mockResolvedValue(undefined) };
const mockMailQueue = { add: jest.fn().mockResolvedValue(undefined) };
const mockAuditLog = { log: jest.fn() };
const mockVibeService = { recomputeCrowdPulse: jest.fn().mockResolvedValue(undefined) };
const mockConfig = { get: jest.fn().mockReturnValue('development') };

// ── Fixtures ──────────────────────────────────────────────────────────────────

const userId = 'user-uuid';
const eventId = 'event-uuid';
const ticketId = 'ticket-uuid';
const orderId = 'order-uuid';

const buyer = { id: userId, firstName: 'Riya', lastName: 'Sen', email: 'riya@example.com', phone: null };

const publishedEvent = {
  id: eventId,
  status: 'PUBLISHED',
  eventDate: new Date(Date.now() + 86400_000), // tomorrow
  platformFeeWaived: false,
  hostProfile: {
    approvalStatus: 'APPROVED',
    subscriptions: [{ lockedFeeRate: 0.05 }],
  },
};

const ticket = {
  id: ticketId,
  eventId,
  name: 'General',
  price: '500',
  totalCapacity: 100,
  soldCount: 0,
  maxPerPerson: null,
  saleStartDate: null,
  saleEndDate: null,
};

const confirmedOrder = {
  id: orderId,
  userId,
  status: 'CONFIRMED',
  totalAmount: '590',
  couponId: null,
  items: [{ ticketId, quantity: 1 }],
  event: {
    eventDate: new Date(Date.now() + 86400_000 * 7), // 7 days away — well inside any cutoff window
    refundPolicy: { type: 'FULL', cutoffHours: 24, refundPercent: null },
  },
};

// ── Test suite ────────────────────────────────────────────────────────────────

describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();

    const module = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: ConfigService, useValue: mockConfig },
        { provide: getQueueToken('mail'), useValue: mockMailQueue },
        { provide: AuditLogService, useValue: mockAuditLog },
        { provide: EventsVibeService, useValue: mockVibeService },
      ],
    }).compile();

    service = module.get(OrdersService);
    jest.clearAllMocks();
    mockConfig.get.mockReturnValue('development');
  });

  // ── createOrder ───────────────────────────────────────────────────────────

  describe('createOrder()', () => {
    const dto = { eventId, items: [{ ticketId, quantity: 1 }] };

    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(buyer);
      prisma.event.findUnique.mockResolvedValue(publishedEvent);
      prisma.eventTicket.findMany.mockResolvedValue([ticket]);
      prisma.order.findUnique.mockResolvedValue(null); // booking ID uniqueness check
      prisma.order.create = jest.fn().mockResolvedValue({ id: orderId, bookingId: 'MDAY-AA-BB', items: [] });
    });

    it('creates an order and returns it', async () => {
      const result = await service.createOrder(userId, dto);
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result).toMatchObject({ id: orderId });
    });

    it('throws NotFoundException when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.createOrder(userId, dto)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when event does not exist', async () => {
      prisma.event.findUnique.mockResolvedValue(null);
      await expect(service.createOrder(userId, dto)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when event is not PUBLISHED', async () => {
      prisma.event.findUnique.mockResolvedValue({ ...publishedEvent, status: 'DRAFT' });
      await expect(service.createOrder(userId, dto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when host is suspended', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...publishedEvent,
        hostProfile: { approvalStatus: 'SUSPENDED', subscriptions: [] },
      });
      await expect(service.createOrder(userId, dto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when event has already passed', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...publishedEvent,
        eventDate: new Date(Date.now() - 86400_000),
      });
      await expect(service.createOrder(userId, dto)).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when ticket does not belong to event', async () => {
      prisma.eventTicket.findMany.mockResolvedValue([]); // no matching tickets
      await expect(service.createOrder(userId, dto)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when sale has not started yet', async () => {
      prisma.eventTicket.findMany.mockResolvedValue([{
        ...ticket,
        saleStartDate: new Date(Date.now() + 3600_000),
      }]);
      await expect(service.createOrder(userId, dto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when sale has ended', async () => {
      prisma.eventTicket.findMany.mockResolvedValue([{
        ...ticket,
        saleEndDate: new Date(Date.now() - 3600_000),
      }]);
      await expect(service.createOrder(userId, dto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when quantity exceeds maxPerPerson', async () => {
      prisma.eventTicket.findMany.mockResolvedValue([{ ...ticket, maxPerPerson: 2 }]);
      prisma.orderItem.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
      await expect(service.createOrder(userId, { ...dto, items: [{ ticketId, quantity: 3 }] }))
        .rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when user already holds max tickets', async () => {
      prisma.eventTicket.findMany.mockResolvedValue([{ ...ticket, maxPerPerson: 2 }]);
      prisma.orderItem.aggregate.mockResolvedValue({ _sum: { quantity: 2 } });
      await expect(service.createOrder(userId, dto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when group attendee details are missing', async () => {
      await expect(
        service.createOrder(userId, {
          ...dto,
          items: [{ ticketId, quantity: 2, groupAttendees: [] }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException on duplicate attendee email', async () => {
      const twoTickets = [
        { ticketId, quantity: 2, groupAttendees: [{ fullName: 'A', email: 'dup@test.com' }] },
        { ticketId: 'ticket-2', quantity: 2, groupAttendees: [{ fullName: 'B', email: 'dup@test.com' }] },
      ];
      prisma.eventTicket.findMany.mockResolvedValue([ticket, { ...ticket, id: 'ticket-2' }]);
      await expect(service.createOrder(userId, { eventId, items: twoTickets }))
        .rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when coupon is inactive', async () => {
      prisma.coupon.findUnique.mockResolvedValue({ isActive: false });
      await expect(service.createOrder(userId, { ...dto, couponCode: 'BAD' }))
        .rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when coupon is not for ATTENDEE', async () => {
      prisma.coupon.findUnique.mockResolvedValue({ isActive: true, target: 'HOST' });
      await expect(service.createOrder(userId, { ...dto, couponCode: 'HOST50' }))
        .rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when coupon is for a different event', async () => {
      prisma.coupon.findUnique.mockResolvedValue({
        isActive: true,
        target: 'ATTENDEE',
        validFrom: null,
        validUntil: null,
        maxUsages: null,
        usageCount: 0,
        maxUsagesPerUser: null,
        eventId: 'other-event-id',
        discountType: 'FLAT',
        discountValue: 100,
        id: 'coupon-id',
      });
      await expect(service.createOrder(userId, { ...dto, couponCode: 'LOCKED' }))
        .rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when capacity is exhausted inside transaction', async () => {
      prisma.$executeRaw.mockResolvedValue(0); // no rows updated = sold out
      prisma.eventTicket.findUnique.mockResolvedValue({ soldCount: 100, totalCapacity: 100 });
      await expect(service.createOrder(userId, dto)).rejects.toThrow(ConflictException);
    });

    it('applies PERCENTAGE coupon discount correctly', async () => {
      const coupon = {
        id: 'c1', target: 'ATTENDEE', discountType: 'PERCENTAGE', discountValue: 10,
        isActive: true, validFrom: null, validUntil: null, maxUsages: null,
        usageCount: 0, maxUsagesPerUser: null, eventId: null,
      };
      prisma.coupon.findUnique.mockResolvedValue(coupon);
      prisma.$executeRaw.mockResolvedValue(1);
      let capturedData: any;
      prisma.order.create = jest.fn().mockImplementation(({ data }: any) => {
        capturedData = data;
        return Promise.resolve({ id: orderId, bookingId: 'MDAY-AA-BB', items: [] });
      });

      await service.createOrder(userId, { ...dto, couponCode: 'SAVE10' });
      // 10% of 500 = 50 discount
      expect(capturedData.discountAmount).toBe(50);
    });

    it('caps FLAT discount at subtotal', async () => {
      const coupon = {
        id: 'c2', target: 'ATTENDEE', discountType: 'FLAT', discountValue: 9999,
        isActive: true, validFrom: null, validUntil: null, maxUsages: null,
        usageCount: 0, maxUsagesPerUser: null, eventId: null,
      };
      prisma.coupon.findUnique.mockResolvedValue(coupon);
      prisma.$executeRaw.mockResolvedValue(1);
      let capturedData: any;
      prisma.order.create = jest.fn().mockImplementation(({ data }: any) => {
        capturedData = data;
        return Promise.resolve({ id: orderId, bookingId: 'MDAY-AA-BB', items: [] });
      });

      await service.createOrder(userId, { ...dto, couponCode: 'SAVE9999' });
      expect(capturedData.discountAmount).toBe(500); // capped at subtotal
    });
  });

  // ── mockConfirm ───────────────────────────────────────────────────────────

  describe('mockConfirm()', () => {
    const pendingOrder = {
      id: orderId,
      userId,
      eventId,
      status: 'PENDING_PAYMENT',
      event: { status: 'PUBLISHED' },
      items: [{ ticket: { name: 'General', saleStartDate: null, saleEndDate: null } }],
    };

    beforeEach(() => {
      prisma.order.findUnique.mockResolvedValue(pendingOrder);
      prisma.order.update.mockResolvedValue({ ...pendingOrder, status: 'CONFIRMED' });
    });

    it('confirms the order and returns success message', async () => {
      const result = await service.mockConfirm(orderId, userId);
      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'CONFIRMED' }) }),
      );
      expect(result).toEqual({ message: 'Order confirmed' });
    });

    it('throws ForbiddenException in production', async () => {
      mockConfig.get.mockReturnValue('production');
      await expect(service.mockConfirm(orderId, userId)).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null);
      await expect(service.mockConfirm(orderId, userId)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when user does not own the order', async () => {
      prisma.order.findUnique.mockResolvedValue({ ...pendingOrder, userId: 'someone-else' });
      await expect(service.mockConfirm(orderId, userId)).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when order is already confirmed', async () => {
      prisma.order.findUnique.mockResolvedValue({ ...pendingOrder, status: 'CONFIRMED' });
      await expect(service.mockConfirm(orderId, userId)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when event is no longer published', async () => {
      prisma.order.findUnique.mockResolvedValue({ ...pendingOrder, event: { status: 'CANCELLED' } });
      await expect(service.mockConfirm(orderId, userId)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when ticket sale has ended', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...pendingOrder,
        items: [{ ticket: { name: 'VIP', saleStartDate: null, saleEndDate: new Date(Date.now() - 3600_000) } }],
      });
      await expect(service.mockConfirm(orderId, userId)).rejects.toThrow(BadRequestException);
    });
  });

  // ── getOrderById ──────────────────────────────────────────────────────────

  describe('getOrderById()', () => {
    it('returns the order when found and owned by user', async () => {
      prisma.order.findUnique.mockResolvedValue({ id: orderId, userId, items: [] });
      const result = await service.getOrderById(orderId, userId);
      expect(result).toMatchObject({ id: orderId });
    });

    it('throws NotFoundException when order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null);
      await expect(service.getOrderById(orderId, userId)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when user does not own the order', async () => {
      prisma.order.findUnique.mockResolvedValue({ id: orderId, userId: 'other-user', items: [] });
      await expect(service.getOrderById(orderId, userId)).rejects.toThrow(ForbiddenException);
    });
  });

  // ── getMyOrders ───────────────────────────────────────────────────────────

  describe('getMyOrders()', () => {
    it('returns paginated orders with total', async () => {
      prisma.order.findMany.mockResolvedValue([{ id: orderId }]);
      prisma.order.count.mockResolvedValue(1);

      const result = await service.getMyOrders(userId);
      expect(result).toEqual({ orders: [{ id: orderId }], total: 1, page: 1, limit: 20 });
    });
  });

  // ── cancelOrder ───────────────────────────────────────────────────────────

  describe('cancelOrder()', () => {
    beforeEach(() => {
      prisma.order.findUnique.mockResolvedValue(confirmedOrder);
    });

    it('cancels the order and returns full refund amount', async () => {
      const result = await service.cancelOrder(orderId, userId);
      expect(result).toEqual({ message: 'Order cancelled successfully', refundAmount: 590 });
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('throws NotFoundException when order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null);
      await expect(service.cancelOrder(orderId, userId)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when user does not own the order', async () => {
      prisma.order.findUnique.mockResolvedValue({ ...confirmedOrder, userId: 'other' });
      await expect(service.cancelOrder(orderId, userId)).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when order is not CONFIRMED', async () => {
      prisma.order.findUnique.mockResolvedValue({ ...confirmedOrder, status: 'PENDING_PAYMENT' });
      await expect(service.cancelOrder(orderId, userId)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when cancellation window has passed', async () => {
      // cutoffHours: 48, event is 24h away — window passed
      prisma.order.findUnique.mockResolvedValue({
        ...confirmedOrder,
        event: {
          eventDate: new Date(Date.now() + 3600_000 * 24), // 24h from now
          refundPolicy: { type: 'FULL', cutoffHours: 48, refundPercent: null },
        },
      });
      await expect(service.cancelOrder(orderId, userId)).rejects.toThrow(BadRequestException);
    });

    it('calculates PARTIAL refund correctly', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...confirmedOrder,
        event: {
          eventDate: new Date(Date.now() + 86400_000 * 7),
          refundPolicy: { type: 'PARTIAL', cutoffHours: 24, refundPercent: 50 },
        },
      });
      const result = await service.cancelOrder(orderId, userId);
      expect(result.refundAmount).toBe(295); // 50% of 590
    });

    it('returns 0 refund for NO_REFUND policy', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...confirmedOrder,
        event: {
          eventDate: new Date(Date.now() + 86400_000 * 7),
          refundPolicy: { type: 'NO_REFUND', cutoffHours: null, refundPercent: null },
        },
      });
      const result = await service.cancelOrder(orderId, userId);
      expect(result.refundAmount).toBe(0);
    });
  });
});
