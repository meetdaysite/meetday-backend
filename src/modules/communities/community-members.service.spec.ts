import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CommunityMembersService, computeActivityScore } from './community-members.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { CommunityPresenceService } from '../community-chat/community-presence.service';
import { CommunityDmService } from '../community-chat/community-dm.service';
import { MemberFilter, MemberSort } from './dto/list-members-query.dto';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePrisma() {
  return {
    community: { findFirst: jest.fn() },
    communityMember: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    orderAttendee: { findMany: jest.fn() },
    communityAnnouncement: { count: jest.fn() },
    userInterestAffinity: { findMany: jest.fn() },
    event: { findMany: jest.fn() },
  } as any;
}

const mockStorage = { getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://cdn.test/avatar.jpg') };
const mockPresence = { getOnlineUserIds: jest.fn() };
const mockDmService = { getDmStatusFor: jest.fn().mockResolvedValue('none') };

// ── Fixtures ─────────────────────────────────────────────────────────────────

const communityId = 'community-uuid';
const viewerId = 'viewer-uuid';

function makeCommunity(overrides: Partial<any> = {}) {
  return {
    id: communityId,
    status: 'PUBLISHED',
    memberVisibility: 'ALL_MEMBERS',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('computeActivityScore (pure function)', () => {
  it('returns 0 for no activity', () => {
    expect(computeActivityScore(0, 0)).toBe(0);
  });

  it('applies MSG_WEIGHT = 1 per message', () => {
    expect(computeActivityScore(10, 0)).toBe(10);
  });

  it('applies EVENT_WEIGHT = 5 per event attended', () => {
    expect(computeActivityScore(0, 3)).toBe(15);
  });

  it('combines message and event weights correctly', () => {
    expect(computeActivityScore(20, 4)).toBe(40); // 20*1 + 4*5
  });
});

describe('CommunityMembersService', () => {
  let service: CommunityMembersService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        CommunityMembersService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: mockStorage },
        { provide: CommunityPresenceService, useValue: mockPresence },
        { provide: CommunityDmService, useValue: mockDmService },
      ],
    }).compile();

    service = module.get(CommunityMembersService);
  });

  describe('list', () => {
    it('throws NotFoundException when community does not exist', async () => {
      prisma.community.findFirst.mockResolvedValue(null);
      await expect(service.list(communityId, viewerId, {})).rejects.toThrow(NotFoundException);
    });

    it('returns empty result immediately when ONLINE filter is active and nobody is online', async () => {
      prisma.community.findFirst.mockResolvedValue(makeCommunity());
      mockPresence.getOnlineUserIds.mockResolvedValue([]);

      const result = await service.list(communityId, viewerId, { filter: MemberFilter.ONLINE });

      expect(prisma.communityMember.findMany).not.toHaveBeenCalled();
      expect(result).toMatchObject({ data: [], featured: [], total: 0 });
    });

    it('queries members and returns paginated result for the ALL filter', async () => {
      prisma.community.findFirst.mockResolvedValue(makeCommunity());
      mockPresence.getOnlineUserIds.mockResolvedValue([]);
      prisma.communityMember.findMany.mockResolvedValue([]);
      prisma.communityMember.count.mockResolvedValue(0);

      const result = await service.list(communityId, viewerId, { filter: MemberFilter.ALL });

      expect(prisma.communityMember.findMany).toHaveBeenCalled();
      expect(result).toMatchObject({ total: 0, page: 1 });
    });
  });

  describe('recomputeEventCount', () => {
    it('returns early without updating when user is not a member of the community', async () => {
      prisma.communityMember.findUnique.mockResolvedValue(null);

      await service.recomputeEventCount(communityId, viewerId);

      expect(prisma.communityMember.update).not.toHaveBeenCalled();
    });

    it('updates eventsAttendedCount and activityScore when user is a member', async () => {
      prisma.communityMember.findUnique.mockResolvedValue({ messageCount: 10 });
      prisma.orderAttendee.findMany.mockResolvedValue([
        { orderItem: { order: { eventId: 'ev-1' } } },
        { orderItem: { order: { eventId: 'ev-2' } } },
      ]);

      await service.recomputeEventCount(communityId, viewerId);

      expect(prisma.communityMember.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { communityId_userId: { communityId, userId: viewerId } },
          data: expect.objectContaining({ eventsAttendedCount: 2 }),
        }),
      );
    });
  });
});
