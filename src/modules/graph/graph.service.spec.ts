import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { NotFoundException } from '@nestjs/common';
import { GraphService } from './graph.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePrisma() {
  return {
    event: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    order: { findMany: jest.fn() },
    orderAttendee: { findMany: jest.fn() },
    userConnection: { findMany: jest.fn(), findUnique: jest.fn() },
    user: { findMany: jest.fn() },
    attendeeProfile: { findMany: jest.fn() },
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
}

const mockStorage = {
  getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://signed.example.com/avatar.jpg'),
};
const mockNotifications = { create: jest.fn().mockResolvedValue(undefined) };
const mockQueue = { add: jest.fn() };

const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';
const U3 = '33333333-3333-3333-3333-333333333333';
const EVENT_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

// ── Test suite ────────────────────────────────────────────────────────────────

describe('GraphService', () => {
  let service: GraphService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();

    const module = await Test.createTestingModule({
      providers: [
        GraphService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: mockStorage },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: getQueueToken('graph'), useValue: mockQueue },
      ],
    }).compile();

    service = module.get(GraphService);
    jest.clearAllMocks();
    prisma.$executeRaw.mockResolvedValue(1);
  });

  // ── recomputeEdgesForEvent ──────────────────────────────────────────────────

  describe('recomputeEdgesForEvent()', () => {
    function mockParticipants(ids: string[]) {
      prisma.orderAttendee.findMany.mockResolvedValue(ids.map((userId) => ({ userId })));
      prisma.order.findMany.mockResolvedValue([]);
    }

    it('recomputes edges and marks the event as processed', async () => {
      mockParticipants([U1, U2]);
      prisma.userConnection.findMany.mockResolvedValue([]);

      const result = await service.recomputeEdgesForEvent(EVENT_ID, false);

      expect(result).toEqual({ participants: 2 });
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(prisma.event.update).toHaveBeenCalledWith({
        where: { id: EVENT_ID },
        data: { graphProcessedAt: expect.any(Date) },
      });
    });

    it('skips edge computation with fewer than 2 resolved participants but still marks processed', async () => {
      mockParticipants([U1]);

      await service.recomputeEdgesForEvent(EVENT_ID, true);

      expect(prisma.$executeRaw).not.toHaveBeenCalled();
      expect(mockNotifications.create).not.toHaveBeenCalled();
      expect(prisma.event.update).toHaveBeenCalled();
    });

    it('nudges both users when a pair newly crosses the threshold', async () => {
      mockParticipants([U1, U2]);
      // before recompute: no crossed pairs; after: U1|U2 crossed
      prisma.userConnection.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ userAId: U1, userBId: U2 }]);
      prisma.user.findMany.mockResolvedValue([
        { id: U1, firstName: 'Asha', attendeeProfile: { privacy: 'PUBLIC' } },
        { id: U2, firstName: 'Ravi', attendeeProfile: null },
      ]);
      prisma.userConnection.findUnique.mockResolvedValue({ coAttendCount: 3 });

      await service.recomputeEdgesForEvent(EVENT_ID, true);

      expect(mockNotifications.create).toHaveBeenCalledTimes(2);
      expect(mockNotifications.create).toHaveBeenCalledWith(
        U1,
        'crossed_paths',
        expect.any(String),
        expect.stringContaining('Ravi'),
        { otherUserId: U2, sharedEventCount: 3 },
      );
      expect(mockNotifications.create).toHaveBeenCalledWith(
        U2,
        'crossed_paths',
        expect.any(String),
        expect.stringContaining('Asha'),
        { otherUserId: U1, sharedEventCount: 3 },
      );
    });

    it('does not re-nudge pairs that were already over the threshold', async () => {
      mockParticipants([U1, U2]);
      prisma.userConnection.findMany
        .mockResolvedValueOnce([{ userAId: U1, userBId: U2 }])
        .mockResolvedValueOnce([{ userAId: U1, userBId: U2 }]);

      await service.recomputeEdgesForEvent(EVENT_ID, true);

      expect(mockNotifications.create).not.toHaveBeenCalled();
    });

    it('suppresses the nudge entirely when either user is PRIVATE', async () => {
      mockParticipants([U1, U2]);
      prisma.userConnection.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ userAId: U1, userBId: U2 }]);
      prisma.user.findMany.mockResolvedValue([
        { id: U1, firstName: 'Asha', attendeeProfile: { privacy: 'PRIVATE' } },
        { id: U2, firstName: 'Ravi', attendeeProfile: { privacy: 'PUBLIC' } },
      ]);

      await service.recomputeEdgesForEvent(EVENT_ID, true);

      expect(mockNotifications.create).not.toHaveBeenCalled();
    });
  });

  // ── getSocialProximity ──────────────────────────────────────────────────────

  describe('getSocialProximity()', () => {
    it('throws for unpublished events', async () => {
      prisma.event.findUnique.mockResolvedValue({ id: EVENT_ID, status: 'DRAFT' });
      await expect(service.getSocialProximity(U1, EVENT_ID)).rejects.toThrow(NotFoundException);
    });

    it('excludes PRIVATE counterparts and ranks ties by weight', async () => {
      prisma.event.findUnique.mockResolvedValue({ id: EVENT_ID, status: 'PUBLISHED' });
      prisma.orderAttendee.findMany.mockResolvedValue([{ userId: U2 }, { userId: U3 }]);
      prisma.order.findMany.mockResolvedValue([]);
      prisma.userConnection.findMany.mockResolvedValue([
        { userAId: U1, userBId: U2, weight: 5, coAttendCount: 3 },
        { userAId: U1, userBId: U3, weight: 2, coAttendCount: 1 },
      ]);
      prisma.attendeeProfile.findMany.mockResolvedValue([{ userId: U3 }]); // U3 is PRIVATE
      prisma.user.findMany.mockResolvedValue([
        { id: U2, firstName: 'Ravi', avatarUrl: 'avatars/ravi.jpg' },
      ]);

      const result = await service.getSocialProximity(U1, EVENT_ID);

      expect(result.knownAttendeeCount).toBe(1);
      expect(result.avatars).toEqual(['https://signed.example.com/avatar.jpg']);
      expect(result.strongestTies).toEqual([{ firstName: 'Ravi', sharedEventCount: 3 }]);
    });

    it('returns an empty result when the caller has no edges at the event', async () => {
      prisma.event.findUnique.mockResolvedValue({ id: EVENT_ID, status: 'PUBLISHED' });
      prisma.orderAttendee.findMany.mockResolvedValue([{ userId: U2 }]);
      prisma.order.findMany.mockResolvedValue([]);
      prisma.userConnection.findMany.mockResolvedValue([]);

      const result = await service.getSocialProximity(U1, EVENT_ID);
      expect(result).toEqual({ knownAttendeeCount: 0, avatars: [], strongestTies: [] });
    });
  });

  // ── cron ────────────────────────────────────────────────────────────────────

  describe('enqueueSettledEvents()', () => {
    it('enqueues a recompute job with nudges enabled for each settled event', async () => {
      prisma.event.findMany.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }]);

      await service.enqueueSettledEvents();

      expect(mockQueue.add).toHaveBeenCalledTimes(2);
      expect(mockQueue.add).toHaveBeenCalledWith(
        'recompute-event-edges',
        { eventId: 'e1', notify: true },
        expect.any(Object),
      );
    });
  });
});
