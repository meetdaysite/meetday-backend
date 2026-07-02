import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { EventsVibeService } from './events-vibe.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { GraphService } from '../graph/graph.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePrisma() {
  return {
    event: { findUnique: jest.fn(), update: jest.fn() },
    attendeeProfile: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    order: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    orderAttendee: { findMany: jest.fn().mockResolvedValue([]) },
    userInterestAffinity: { findMany: jest.fn().mockResolvedValue([]) },
    interestCategory: { findMany: jest.fn().mockResolvedValue([]) },
    interest: { findMany: jest.fn().mockResolvedValue([]) },
  } as any;
}

const mockStorage = { getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://cdn.test/avatar.jpg') };
const mockGraph = {
  getProximityForScore: jest.fn().mockResolvedValue({ knownAttendeeCount: 0, friendsAttending: [] }),
};

// ── Fixtures ─────────────────────────────────────────────────────────────────

const eventId = 'event-uuid';

function makeVibeMatchDto(overrides: Record<string, any> = {}): any {
  return {
    vibeType: 'EXPLORER',
    socialStyle: 'SOCIAL_BUTTERFLY',
    interests: [],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EventsVibeService', () => {
  let service: EventsVibeService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        EventsVibeService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: mockStorage },
        { provide: GraphService, useValue: mockGraph },
      ],
    }).compile();

    service = module.get(EventsVibeService);
  });

  describe('getVibeMatch', () => {
    it('throws NotFoundException when event does not exist', async () => {
      prisma.event.findUnique.mockResolvedValue(null);

      await expect(service.getVibeMatch(eventId, makeVibeMatchDto())).rejects.toThrow(NotFoundException);
    });

    it('returns a vibe match response for an anonymous caller with no stored profile', async () => {
      prisma.event.findUnique.mockResolvedValue({ id: eventId, categoryId: null, crowdPulse: null });
      prisma.interestCategory.findMany.mockResolvedValue([]);

      const result = await service.getVibeMatch(eventId, makeVibeMatchDto());

      expect(result).toBeDefined();
    });

    it('returns a result for an authenticated caller and fetches graph proximity', async () => {
      prisma.event.findUnique.mockResolvedValue({ id: eventId, categoryId: null, crowdPulse: null });
      prisma.attendeeProfile.findUnique.mockResolvedValue({ vibeType: 'LIFE_OF_PARTY', socialStyle: 'OPEN_TO_MEETING' });
      prisma.userInterestAffinity.findMany.mockResolvedValue([]);
      prisma.interestCategory.findMany.mockResolvedValue([]);
      mockGraph.getProximityForScore.mockResolvedValue({ knownAttendeeCount: 2, friendsAttending: ['user-2', 'user-3'] });

      const result = await service.getVibeMatch(eventId, makeVibeMatchDto(), 'user-uuid');

      expect(mockGraph.getProximityForScore).toHaveBeenCalledWith('user-uuid', eventId);
      expect(result).toBeDefined();
    });
  });

  describe('recomputeCrowdPulse', () => {
    it('completes without throwing when the event has no attendees', async () => {
      prisma.attendeeProfile.findMany.mockResolvedValue([]);
      prisma.event.update.mockResolvedValue({});

      await expect(service.recomputeCrowdPulse(eventId)).resolves.toBeUndefined();
      expect(prisma.event.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: eventId } }),
      );
    });

    it('computes crowd pulse from attendee profiles and updates the event', async () => {
      prisma.attendeeProfile.findMany.mockResolvedValue([
        { vibeType: 'LIFE_OF_PARTY', socialStyle: 'OPEN_TO_MEETING' },
        { vibeType: 'CHILL_OBSERVING', socialStyle: 'SOLO_EXPLORER' },
      ]);
      prisma.event.update.mockResolvedValue({});

      await service.recomputeCrowdPulse(eventId);

      expect(prisma.event.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: eventId } }),
      );
    });
  });
});
