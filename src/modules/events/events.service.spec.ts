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
});
