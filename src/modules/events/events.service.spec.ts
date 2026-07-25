import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EventsService } from './events.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { RedisService } from '../../common/redis/redis.service';
import { RefundsService } from '../refunds/refunds.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePrisma() {
  const prisma: any = {
    hostProfile: { findUnique: jest.fn() },
    category: { findFirst: jest.fn() },
    event: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
    },
    eventTicket: { deleteMany: jest.fn(), createMany: jest.fn() },
    eventRefundPolicy: { upsert: jest.fn() },
    eventMedia: { deleteMany: jest.fn(), createMany: jest.fn() },
    order: { findMany: jest.fn(), updateMany: jest.fn() },
    user: { findMany: jest.fn() },
    eventReview: { aggregate: jest.fn(), findMany: jest.fn() },
    interest: { findMany: jest.fn() },
  };
  prisma.$transaction = jest.fn().mockImplementation(async (fn: any) => fn(prisma));
  prisma.$executeRaw = jest.fn().mockResolvedValue(1);
  // updateEvent's in-transaction `SELECT ... FOR UPDATE` status re-check. Default to DRAFT;
  // tests exercising the under-review recall override this per-call.
  prisma.$queryRaw = jest.fn().mockResolvedValue([{ status: 'DRAFT' }]);
  return prisma;
}

const mockStorage = { getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://cdn.example.com/img') };
const mockNotifications = { create: jest.fn().mockResolvedValue(undefined) };
const mockAuditLog = { log: jest.fn() };

// ── Fixtures ──────────────────────────────────────────────────────────────────

const userId = 'host-user-uuid';
const eventId = 'event-uuid';

const approvedHost = { id: 'hp-uuid', approvalStatus: 'APPROVED' };

const draftEvent = {
  id: eventId,
  status: 'DRAFT',
  isFree: false,
  hostProfile: { id: 'hp-uuid', displayName: 'Test Host', userId },
  communities: [],
};

const fullDraftEvent = {
  ...draftEvent,
  title: 'Indie Night',
  description: 'Music event',
  eventType: 'IN_PERSON',
  categoryId: 'cat-uuid',
  languages: ['en'],
  eventDate: new Date(Date.now() + 86400_000),
  startTime: '07:00 PM',
  endTime: '10:00 PM',
  venueName: 'The Venue',
  fullAddress: '123 Main St',
  whatToExpect: ['fun'],
  whoShouldAttend: ['music lovers'],
  tickets: [{ id: 't1' }],
  refundPolicy: { id: 'rp1' },
  media: [],
};

// ── Test suite ────────────────────────────────────────────────────────────────

describe('EventsService', () => {
  let service: EventsService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();

    const module = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: mockStorage },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: AuditLogService, useValue: mockAuditLog },
        { provide: RedisService, useValue: { get: jest.fn().mockResolvedValue(null), set: jest.fn(), del: jest.fn() } },
        { provide: RefundsService, useValue: { cancelEventOrders: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = module.get(EventsService);
    jest.clearAllMocks();
  });

  // ── createEvent ───────────────────────────────────────────────────────────

  describe('createEvent()', () => {
    const dto: any = { title: 'Indie Night', eventDate: new Date(Date.now() + 86400_000).toISOString() };

    beforeEach(() => {
      prisma.hostProfile.findUnique.mockResolvedValue(approvedHost);
      prisma.event.create.mockResolvedValue({ id: eventId, ...dto });
    });

    it('creates and returns the event', async () => {
      const result = await service.createEvent(userId, dto);
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result).toMatchObject({ id: eventId });
    });

    it('throws NotFoundException when host profile does not exist', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue(null);
      await expect(service.createEvent(userId, dto)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when host is not approved', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue({ ...approvedHost, approvalStatus: 'PENDING' });
      await expect(service.createEvent(userId, dto)).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when category is inactive', async () => {
      prisma.category.findFirst.mockResolvedValue(null);
      await expect(service.createEvent(userId, { ...dto, categoryId: 'bad-cat' })).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when free event has paid tickets', async () => {
      await expect(
        service.createEvent(userId, { ...dto, isFree: true, tickets: [{ name: 'Paid', price: 500 }] }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── updateEvent ───────────────────────────────────────────────────────────

  describe('updateEvent()', () => {
    beforeEach(() => {
      prisma.event.findUnique.mockResolvedValue(draftEvent);
      prisma.event.findUnique.mockImplementation(({ where }: any) =>
        where?.id === eventId
          ? Promise.resolve(draftEvent)
          : Promise.resolve(null),
      );
      prisma.event.update.mockResolvedValue(draftEvent);
    });

    it('throws NotFoundException when event does not exist', async () => {
      prisma.event.findUnique.mockResolvedValue(null);
      await expect(service.updateEvent(userId, eventId, {} as any)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when user does not own the event', async () => {
      prisma.event.findUnique.mockResolvedValue({ ...draftEvent, hostProfile: { userId: 'other' } });
      await expect(service.updateEvent(userId, eventId, {} as any)).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when event is not DRAFT', async () => {
      prisma.event.findUnique.mockResolvedValue({ ...draftEvent, status: 'PUBLISHED' });
      await expect(service.updateEvent(userId, eventId, {} as any)).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when update makes a free event have paid tickets', async () => {
      prisma.event.findUnique.mockResolvedValue({ ...draftEvent, isFree: true });
      await expect(
        service.updateEvent(userId, eventId, { tickets: [{ name: 'VIP', price: 1000 }] } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── submitEvent ───────────────────────────────────────────────────────────

  describe('submitEvent()', () => {
    beforeEach(() => {
      prisma.event.findUnique.mockResolvedValue(fullDraftEvent);
      prisma.event.update.mockResolvedValue({ ...fullDraftEvent, status: 'UNDER_REVIEW' });
      prisma.user.findMany.mockResolvedValue([]);
    });

    it('transitions event to UNDER_REVIEW', async () => {
      const result = await service.submitEvent(userId, eventId);
      expect(prisma.event.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'UNDER_REVIEW' }) }),
      );
      expect(result).toMatchObject({ status: 'UNDER_REVIEW' });
    });

    it('throws NotFoundException when event does not exist', async () => {
      prisma.event.findUnique.mockResolvedValue(null);
      await expect(service.submitEvent(userId, eventId)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when host is suspended', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...fullDraftEvent,
        hostProfile: { ...fullDraftEvent.hostProfile, approvalStatus: 'SUSPENDED' },
      });
      await expect(service.submitEvent(userId, eventId)).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when event is not DRAFT', async () => {
      prisma.event.findUnique.mockResolvedValue({ ...fullDraftEvent, status: 'UNDER_REVIEW' });
      await expect(service.submitEvent(userId, eventId)).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when required fields are missing', async () => {
      prisma.event.findUnique.mockResolvedValue({ ...fullDraftEvent, title: null });
      await expect(service.submitEvent(userId, eventId)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when eventDate is in the past', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...fullDraftEvent,
        eventDate: new Date(Date.now() - 86400_000),
      });
      await expect(service.submitEvent(userId, eventId)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when no tickets are attached', async () => {
      prisma.event.findUnique.mockResolvedValue({ ...fullDraftEvent, tickets: [] });
      await expect(service.submitEvent(userId, eventId)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when refundPolicy is missing', async () => {
      prisma.event.findUnique.mockResolvedValue({ ...fullDraftEvent, refundPolicy: null });
      await expect(service.submitEvent(userId, eventId)).rejects.toThrow(BadRequestException);
    });
  });

  // ── deleteEvent ───────────────────────────────────────────────────────────

  describe('deleteEvent()', () => {
    beforeEach(() => {
      prisma.event.findUnique.mockResolvedValue(draftEvent);
      prisma.event.delete.mockResolvedValue(undefined);
    });

    it('deletes a DRAFT event', async () => {
      await service.deleteEvent(userId, eventId);
      expect(prisma.event.delete).toHaveBeenCalledWith({ where: { id: eventId } });
    });

    it('throws NotFoundException when event does not exist', async () => {
      prisma.event.findUnique.mockResolvedValue(null);
      await expect(service.deleteEvent(userId, eventId)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when user does not own the event', async () => {
      prisma.event.findUnique.mockResolvedValue({ ...draftEvent, hostProfile: { userId: 'other' } });
      await expect(service.deleteEvent(userId, eventId)).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when event is not DRAFT', async () => {
      prisma.event.findUnique.mockResolvedValue({ ...draftEvent, status: 'PUBLISHED' });
      await expect(service.deleteEvent(userId, eventId)).rejects.toThrow(BadRequestException);
    });
  });

  // ── cancelEvent ───────────────────────────────────────────────────────────

  describe('cancelEvent()', () => {
    const publishedEvent = { ...draftEvent, status: 'PUBLISHED' };

    beforeEach(() => {
      prisma.event.findUnique.mockResolvedValue(publishedEvent);
      prisma.order.findMany.mockResolvedValue([]);
      prisma.event.update.mockResolvedValue({ ...publishedEvent, status: 'CANCELLED' });
    });

    it('cancels the event', async () => {
      const result = await service.cancelEvent(userId, eventId, { cancellationReason: 'Venue issue' });
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result).toMatchObject({ status: 'CANCELLED' });
    });

    it('throws NotFoundException when event does not exist', async () => {
      prisma.event.findUnique.mockResolvedValue(null);
      await expect(service.cancelEvent(userId, eventId, { cancellationReason: '' })).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when user does not own the event', async () => {
      prisma.event.findUnique.mockResolvedValue({ ...publishedEvent, hostProfile: { userId: 'other' } });
      await expect(service.cancelEvent(userId, eventId, { cancellationReason: '' })).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when event is not PUBLISHED', async () => {
      prisma.event.findUnique.mockResolvedValue(draftEvent);
      await expect(service.cancelEvent(userId, eventId, { cancellationReason: '' })).rejects.toThrow(BadRequestException);
    });
  });

  // ── browseEvents ──────────────────────────────────────────────────────────

  describe('browseEvents()', () => {
    const eventRow = {
      id: eventId,
      title: 'Indie Night',
      eventType: 'IN_PERSON',
      eventDate: new Date(Date.now() + 86400_000),
      startTime: '07:00 PM',
      venueName: 'The Venue',
      tags: [],
      category: { id: 'c1', name: 'Music' },
      media: [{ url: 'covers/img.jpg' }],
      tickets: [{ price: '500' }],
    };

    beforeEach(() => {
      prisma.event.findMany.mockResolvedValue([eventRow]);
      prisma.event.count.mockResolvedValue(1);
    });

    it('returns enriched event list with signed cover URL', async () => {
      const result = await service.browseEvents({});
      expect(result.total).toBe(1);
      expect(result.events[0].coverImageUrl).toBe('https://cdn.example.com/img');
      expect(result.events[0].startingPrice).toBe(500);
    });

    it('returns null coverImageUrl when event has no cover media', async () => {
      prisma.event.findMany.mockResolvedValue([{ ...eventRow, media: [] }]);
      const result = await service.browseEvents({});
      expect(result.events[0].coverImageUrl).toBeNull();
    });

    it('returns null startingPrice for free events with no ticket prices', async () => {
      prisma.event.findMany.mockResolvedValue([{ ...eventRow, tickets: [{ price: '0' }] }]);
      const result = await service.browseEvents({});
      expect(result.events[0].startingPrice).toBeNull();
    });
  });

  // ── updateEvent — success paths ───────────────────────────────────────────

  describe('updateEvent() — success paths', () => {
    beforeEach(() => {
      prisma.event.findUnique.mockResolvedValue(draftEvent);
      prisma.event.update.mockResolvedValue(draftEvent);
    });

    it('replaces tickets when dto.tickets is provided', async () => {
      prisma.eventTicket.deleteMany.mockResolvedValue({});
      prisma.eventTicket.createMany.mockResolvedValue({});

      await service.updateEvent(userId, eventId, { tickets: [{ name: 'GA', price: 0, totalCapacity: 100 }] } as any);

      expect(prisma.eventTicket.deleteMany).toHaveBeenCalledWith({ where: { eventId } });
      expect(prisma.eventTicket.createMany).toHaveBeenCalled();
    });

    it('upserts refundPolicy when dto.refundPolicy is provided', async () => {
      prisma.eventRefundPolicy.upsert.mockResolvedValue({});

      await service.updateEvent(userId, eventId, {
        refundPolicy: { type: 'NO_REFUND', refundTo: 'ORIGINAL_PAYMENT_METHOD' },
      } as any);

      expect(prisma.eventRefundPolicy.upsert).toHaveBeenCalled();
    });

    it('replaces media when dto.media is provided', async () => {
      prisma.eventMedia.deleteMany.mockResolvedValue({});
      prisma.eventMedia.createMany.mockResolvedValue({});

      await service.updateEvent(userId, eventId, {
        media: [{ key: 'covers/img.jpg', type: 'COVER', order: 0 }],
      } as any);

      expect(prisma.eventMedia.deleteMany).toHaveBeenCalledWith({ where: { eventId } });
      expect(prisma.eventMedia.createMany).toHaveBeenCalled();
    });

    it('throws NotFoundException when categoryId is invalid', async () => {
      prisma.category.findFirst.mockResolvedValue(null);

      await expect(
        service.updateEvent(userId, eventId, { categoryId: 'bad-cat' } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('recalls an under-review event to DRAFT (clearing submittedAt) when edited', async () => {
      prisma.event.findUnique.mockResolvedValue({ ...draftEvent, status: 'UNDER_REVIEW' });
      prisma.$queryRaw.mockResolvedValueOnce([{ status: 'UNDER_REVIEW' }]);

      await service.updateEvent(userId, eventId, { title: 'Updated title' } as any);

      expect(prisma.event.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'DRAFT', submittedAt: null }),
        }),
      );
    });

    it('does not change status when editing a draft event', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ status: 'DRAFT' }]);

      await service.updateEvent(userId, eventId, { title: 'Updated title' } as any);

      expect(prisma.event.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'DRAFT', submittedAt: null }) }),
      );
    });
  });

  // ── getMyEvents() ─────────────────────────────────────────────────────────

  describe('getMyEvents()', () => {
    const myEventRow = {
      id: eventId,
      title: 'Indie Night',
      status: 'DRAFT',
      eventDate: new Date(Date.now() + 86400_000),
      city: 'Mumbai',
      venueName: 'The Venue',
      isFree: false,
      adminRejectionRemark: null,
      submittedAt: null,
      createdAt: new Date(),
      category: { id: 'c1', name: 'Music' },
      media: [{ url: 'covers/img.jpg' }],
      tickets: [{ totalCapacity: 100, price: '500' }],
    };

    beforeEach(() => {
      prisma.hostProfile.findUnique.mockResolvedValue(approvedHost);
      prisma.event.findMany.mockResolvedValue([myEventRow]);
      prisma.event.count.mockResolvedValue(1);
    });

    it('throws NotFoundException when host profile not found', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue(null);
      await expect(service.getMyEvents(userId, {})).rejects.toThrow(NotFoundException);
    });

    it('returns enriched list with signed cover URL and pricing', async () => {
      const result = await service.getMyEvents(userId, {});

      expect(result.total).toBe(1);
      expect(result.events[0].coverImageUrl).toBe('https://cdn.example.com/img');
      expect(result.events[0].totalCapacity).toBe(100);
      expect(result.events[0].startingPrice).toBe(500);
    });

    it('returns null coverImageUrl and startingPrice when event has no media or paid tickets', async () => {
      prisma.event.findMany.mockResolvedValue([{
        ...myEventRow,
        media: [],
        tickets: [{ totalCapacity: 50, price: '0' }],
      }]);

      const result = await service.getMyEvents(userId, {});
      expect(result.events[0].coverImageUrl).toBeNull();
      expect(result.events[0].startingPrice).toBeNull();
    });

    it('filters by status when provided in query', async () => {
      await service.getMyEvents(userId, { status: 'DRAFT' as any });
      expect(prisma.event.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'DRAFT' }) }),
      );
    });
  });

  // ── getMyEventById() ──────────────────────────────────────────────────────

  describe('getMyEventById()', () => {
    const eventWithMedia = {
      ...draftEvent,
      media: [{ url: 'covers/photo.jpg', type: 'COVER', order: 0 }],
    };

    it('returns event with signed media URLs', async () => {
      prisma.event.findUnique.mockResolvedValue(eventWithMedia);

      const result = await service.getMyEventById(userId, eventId);
      expect(result.media[0].url).toBe('https://cdn.example.com/img');
    });

    it('throws NotFoundException when event not found', async () => {
      prisma.event.findUnique.mockResolvedValue(null);
      await expect(service.getMyEventById(userId, eventId)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when user does not own the event', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...eventWithMedia,
        hostProfile: { id: 'hp-uuid', displayName: 'Test Host', userId: 'other-user' },
      });
      await expect(service.getMyEventById(userId, eventId)).rejects.toThrow(ForbiddenException);
    });
  });

  // ── cancelEvent — with pending orders ────────────────────────────────────

  describe('cancelEvent() — with pending orders', () => {
    const publishedEvent = { ...draftEvent, status: 'PUBLISHED' };

    beforeEach(() => {
      prisma.event.findUnique.mockResolvedValue(publishedEvent);
      prisma.event.update.mockResolvedValue({ ...publishedEvent, status: 'CANCELLED' });
      prisma.order.updateMany.mockResolvedValue({});
    });

    it('rolls back soldCount for each item and cancels pending orders', async () => {
      prisma.order.findMany.mockResolvedValue([{
        id: 'order-uuid',
        couponId: null,
        items: [{ id: 'item-uuid', ticketId: 'ticket-uuid', quantity: 2, cancelledCount: 0, attendees: [] }],
      }]);

      await service.cancelEvent(userId, eventId, { cancellationReason: 'Venue issue' });

      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(prisma.order.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'CANCELLED', cancellationReason: 'EVENT_CANCELLED' }),
        }),
      );
    });

    it('also decrements coupon usageCount when order has a coupon', async () => {
      prisma.order.findMany.mockResolvedValue([{
        id: 'order-uuid',
        couponId: 'coupon-uuid',
        items: [{ id: 'item-uuid', ticketId: 'ticket-uuid', quantity: 1, cancelledCount: 0, attendees: [] }],
      }]);

      await service.cancelEvent(userId, eventId, { cancellationReason: 'Venue issue' });

      // twice: once for soldCount, once for coupon usageCount
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    });

    it('skips raw SQL and updateMany when no pending orders exist', async () => {
      prisma.order.findMany.mockResolvedValue([]);

      await service.cancelEvent(userId, eventId, { cancellationReason: 'Venue issue' });

      expect(prisma.$executeRaw).not.toHaveBeenCalled();
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
    });
  });

  // ── browseEvents — additional filters ────────────────────────────────────

  describe('browseEvents() — additional filters', () => {
    const baseRow = {
      id: eventId,
      title: 'Indie Night',
      eventType: 'IN_PERSON',
      eventDate: new Date(Date.now() + 86400_000),
      startTime: '07:00 PM',
      venueName: 'The Venue',
      tags: [],
      category: { id: 'c1', name: 'Music' },
      media: [],
      tickets: [],
    };

    beforeEach(() => {
      prisma.event.findMany.mockResolvedValue([baseRow]);
      prisma.event.count.mockResolvedValue(1);
    });

    it('resolves interest slugs to category IDs and applies filter', async () => {
      prisma.interest.findMany.mockResolvedValue([
        { categoryMappings: [{ categoryId: 'cat-1' }, { categoryId: 'cat-2' }] },
      ]);

      await service.browseEvents({ interestSlugs: ['music'] } as any);

      expect(prisma.interest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { slug: { in: ['music'] } } }),
      );
      expect(prisma.event.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ categoryId: { in: expect.arrayContaining(['cat-1', 'cat-2']) } }),
        }),
      );
    });

    it('sorts by ticket price when sortBy=price', async () => {
      await service.browseEvents({ sortBy: 'price' as any });

      expect(prisma.event.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { tickets: { _min: { price: 'asc' } } } }),
      );
    });

    it('sorts by eventDate when sortBy is not price', async () => {
      await service.browseEvents({ sortBy: 'date' as any, sortOrder: 'desc' as any });

      expect(prisma.event.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { eventDate: 'desc' } }),
      );
    });
  });

  // ── getPublicEventById() ──────────────────────────────────────────────────

  describe('getPublicEventById()', () => {
    const publicEvent = {
      id: eventId,
      title: 'Indie Night',
      description: 'Music event',
      eventType: 'IN_PERSON',
      languages: ['en'],
      tags: ['live'],
      eventDate: new Date(Date.now() + 86400_000),
      startTime: '07:00 PM',
      endTime: '10:00 PM',
      venueName: 'The Venue',
      fullAddress: '123 Main St',
      city: 'Mumbai',
      latitude: 19.076,
      longitude: 72.877,
      whatToExpect: ['fun'],
      whoShouldAttend: ['music lovers'],
      vibeSummary: null,
      crowdPulse: null,
      isFree: false,
      ageRestriction: null,
      specialInstructions: null,
      category: { id: 'c1', name: 'Music' },
      hostProfile: { id: 'hp-uuid', displayName: 'Test Host', tagline: null, averageRating: null, totalReviews: 0, totalEventsHosted: 0 },
      tickets: [{ id: 't1', name: 'GA', price: '500', totalCapacity: 100, maxPerPerson: 4, description: null, saleStartDate: null, saleEndDate: null }],
      refundPolicy: { id: 'rp1', type: 'NO_REFUND', cutoffHours: null, refundPercent: null, refundTo: 'ORIGINAL_PAYMENT_METHOD' },
      media: [{ url: 'covers/photo.jpg', type: 'COVER', order: 0 }],
      communities: [],
    };

    beforeEach(() => {
      prisma.event.findUnique.mockResolvedValue(publicEvent);
      prisma.eventReview.aggregate.mockResolvedValue({ _avg: { rating: 4.5 }, _count: { rating: 10 } });
      prisma.eventReview.findMany.mockResolvedValue([{
        id: 'rev-1',
        rating: 5,
        highlights: [],
        body: 'Great event!',
        createdAt: new Date(),
        user: { id: 'u1', firstName: 'Jane', lastName: 'Doe', avatarUrl: null },
        photos: [],
      }]);
    });

    it('returns event with signed media, starting price, and review summary', async () => {
      const result = await service.getPublicEventById(eventId);

      expect(result.media[0].url).toBe('https://cdn.example.com/img');
      expect(result.startingPrice).toBe(500);
      expect(result.reviewSummary.averageRating).toBe(4.5);
      expect(result.reviewSummary.reviewCount).toBe(10);
      expect(result.reviewSummary.recentReviews).toHaveLength(1);
    });

    it('throws NotFoundException when event is not found or not published/public', async () => {
      prisma.event.findUnique.mockResolvedValue(null);
      await expect(service.getPublicEventById(eventId)).rejects.toThrow(NotFoundException);
    });

    it('returns null startingPrice and averageRating for free event with no reviews', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...publicEvent,
        media: [],
        tickets: [{ ...publicEvent.tickets[0], price: '0' }],
      });
      prisma.eventReview.aggregate.mockResolvedValue({ _avg: { rating: null }, _count: { rating: 0 } });
      prisma.eventReview.findMany.mockResolvedValue([]);

      const result = await service.getPublicEventById(eventId);
      expect(result.startingPrice).toBeNull();
      expect(result.reviewSummary.averageRating).toBeNull();
    });

    it('signs photo URLs on recent reviews', async () => {
      prisma.eventReview.findMany.mockResolvedValue([{
        id: 'rev-1',
        rating: 5,
        highlights: [],
        body: 'Great!',
        createdAt: new Date(),
        user: { id: 'u1', firstName: 'Jane', lastName: 'Doe', avatarUrl: null },
        photos: [{ id: 'photo-1', key: 'reviews/photo.jpg' }],
      }]);

      const result = await service.getPublicEventById(eventId);
      expect(result.reviewSummary.recentReviews[0].photos[0].url).toBe('https://cdn.example.com/img');
    });
  });
});
