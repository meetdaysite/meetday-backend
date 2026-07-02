import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CommunityFeedService } from './community-feed.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePrisma() {
  return {
    communityMember: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    communityPost: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    communitySettings: { findUnique: jest.fn() },
    communityEvent: { findFirst: jest.fn() },
    orderAttendee: { findFirst: jest.fn() },
    community: { findUnique: jest.fn() },
    communityPostReaction: { findMany: jest.fn().mockResolvedValue([]) },
    communityPostBookmark: { findMany: jest.fn().mockResolvedValue([]) },
    communityPostShare: { findMany: jest.fn().mockResolvedValue([]) },
    communityPostPollVote: { findMany: jest.fn().mockResolvedValue([]) },
    postReaction: { findFirst: jest.fn(), create: jest.fn(), delete: jest.fn() },
  } as any;
}

const mockStorage = { getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://cdn.test/img.jpg') };
const mockAuditLog = { log: jest.fn() };
const mockNotifications = { create: jest.fn().mockResolvedValue(undefined) };

// ── Fixtures ─────────────────────────────────────────────────────────────────

const communityId = 'community-uuid';
const authorId = 'author-uuid';
const postId = 'post-uuid';

function makePost(overrides: Partial<any> = {}) {
  return {
    id: postId,
    communityId,
    authorId,
    postType: 'TEXT',
    status: 'APPROVED',
    content: 'Hello community!',
    mediaKeys: [],
    deletedAt: null,
    createdAt: new Date(),
    author: { id: authorId, firstName: 'Alice', lastName: 'Host', avatarUrl: null },
    event: null,
    pollOptions: [],
    ...overrides,
  };
}

function makeMember(role = 'MEMBER') {
  return { role, status: 'ACTIVE', activityScore: 10, joinedAt: new Date() };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CommunityFeedService', () => {
  let service: CommunityFeedService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        CommunityFeedService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: mockStorage },
        { provide: AuditLogService, useValue: mockAuditLog },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get(CommunityFeedService);
  });

  const defaultSettings = { feedEnabled: true, feedPosting: 'ALL_MEMBERS', requirePostApproval: false };

  describe('createPost', () => {
    it('throws ForbiddenException when the feed is disabled for the community', async () => {
      prisma.communitySettings.findUnique.mockResolvedValue({ feedEnabled: false, feedPosting: 'ALL_MEMBERS', requirePostApproval: false });

      await expect(
        service.createPost(communityId, authorId, 'MEMBER' as any, { postType: 'TEXT', content: 'Hi' } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when POLL has fewer than 2 options', async () => {
      prisma.communitySettings.findUnique.mockResolvedValue(defaultSettings);

      await expect(
        service.createPost(communityId, authorId, 'MEMBER' as any, {
          postType: 'POLL' as any,
          content: 'Pick one',
          pollOptions: [{ text: 'Option A', position: 0 }],
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when linked eventId is not in this community', async () => {
      prisma.communitySettings.findUnique.mockResolvedValue(defaultSettings);
      prisma.communityEvent.findFirst.mockResolvedValue(null);

      await expect(
        service.createPost(communityId, authorId, 'MEMBER' as any, {
          postType: 'TEXT' as any,
          content: 'Check this event',
          eventId: 'event-uuid',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a TEXT post successfully', async () => {
      prisma.communitySettings.findUnique.mockResolvedValue(defaultSettings);
      prisma.communityPost.create.mockResolvedValue(makePost());

      const result = await service.createPost(
        communityId,
        authorId,
        'MEMBER' as any,
        { postType: 'TEXT' as any, content: 'Hello community!' } as any,
      );

      expect(prisma.communityPost.create).toHaveBeenCalled();
      expect(result).toMatchObject({ id: postId });
    });
  });

  describe('deletePost', () => {
    it('throws NotFoundException when post does not exist', async () => {
      prisma.communityPost.findFirst.mockResolvedValue(null);

      await expect(service.deletePost(communityId, postId, authorId, 'MEMBER' as any)).rejects.toThrow(NotFoundException);
    });

    it('soft-deletes a post the author owns', async () => {
      prisma.communityPost.findFirst.mockResolvedValue(makePost());
      prisma.communityPost.update.mockResolvedValue(makePost({ deletedAt: new Date() }));

      await service.deletePost(communityId, postId, authorId, 'MEMBER' as any);

      expect(prisma.communityPost.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
      );
    });
  });
});
