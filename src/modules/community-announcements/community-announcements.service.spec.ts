import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bull';
import { CommunityAnnouncementsService } from './community-announcements.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { StorageService } from '../../common/storage/storage.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePrisma() {
  return {
    community: { findFirst: jest.fn() },
    communityAnnouncement: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
  } as any;
}

const mockAuditLog = { log: jest.fn() };
const mockStorage = { getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://cdn.test/image.jpg') };
const mockQueue = { add: jest.fn().mockResolvedValue(undefined) };

// ── Fixtures ─────────────────────────────────────────────────────────────────

const communityId = 'community-uuid';
const hostId = 'host-uuid';
const announcementId = 'announcement-uuid';

function makeAnnouncement(overrides: Partial<any> = {}) {
  return {
    id: announcementId,
    communityId,
    authorId: hostId,
    authorRole: 'HOST',
    category: 'GENERAL',
    title: 'Test Announcement',
    body: 'This is a test.',
    imageKey: null,
    status: 'PUBLISHED',
    scheduledAt: null,
    publishedAt: new Date(),
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    author: { id: hostId, firstName: 'Alice', lastName: 'Host', avatarUrl: null },
    ...overrides,
  };
}

const createDto = {
  category: 'GENERAL' as any,
  title: 'Test Announcement',
  body: 'This is a test.',
  imageKey: null,
  status: 'PUBLISHED' as any,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CommunityAnnouncementsService', () => {
  let service: CommunityAnnouncementsService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        CommunityAnnouncementsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: mockAuditLog },
        { provide: StorageService, useValue: mockStorage },
        { provide: getQueueToken('community-announcements'), useValue: mockQueue },
      ],
    }).compile();

    service = module.get(CommunityAnnouncementsService);
  });

  describe('createAsHost', () => {
    it('throws NotFoundException when community does not exist', async () => {
      prisma.community.findFirst.mockResolvedValue(null);

      await expect(service.createAsHost(communityId, hostId, createDto)).rejects.toThrow(NotFoundException);
    });

    it('creates a PUBLISHED announcement and adds a fan-out queue job immediately', async () => {
      prisma.community.findFirst.mockResolvedValue({ id: communityId });
      const announcement = makeAnnouncement();
      prisma.communityAnnouncement.create.mockResolvedValue(announcement);

      await service.createAsHost(communityId, hostId, createDto);

      expect(prisma.communityAnnouncement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PUBLISHED', publishedAt: expect.any(Date) }),
        }),
      );
      expect(mockQueue.add).toHaveBeenCalledWith('fan-out', expect.objectContaining({ announcementId }), expect.any(Object));
    });

    it('creates a DRAFT announcement without queuing any fan-out job', async () => {
      prisma.community.findFirst.mockResolvedValue({ id: communityId });
      const draftDto = { ...createDto, status: 'DRAFT' as any };
      prisma.communityAnnouncement.create.mockResolvedValue(makeAnnouncement({ status: 'DRAFT', publishedAt: null }));

      await service.createAsHost(communityId, hostId, draftDto);

      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('schedules a delayed fan-out job for SCHEDULED announcements', async () => {
      prisma.community.findFirst.mockResolvedValue({ id: communityId });
      const futureDate = new Date(Date.now() + 3600_000).toISOString();
      const scheduledDto = { ...createDto, status: 'SCHEDULED' as any, scheduledAt: futureDate };
      prisma.communityAnnouncement.create.mockResolvedValue(makeAnnouncement({ status: 'SCHEDULED', publishedAt: null, scheduledAt: new Date(futureDate) }));

      await service.createAsHost(communityId, hostId, scheduledDto);

      const queueCall = mockQueue.add.mock.calls[0];
      expect(queueCall[2]).toMatchObject({ delay: expect.any(Number) });
      expect(queueCall[2].delay).toBeGreaterThan(0);
    });

    it('logs an audit event after creation', async () => {
      prisma.community.findFirst.mockResolvedValue({ id: communityId });
      prisma.communityAnnouncement.create.mockResolvedValue(makeAnnouncement());

      await service.createAsHost(communityId, hostId, createDto);

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ANNOUNCEMENT_CREATED', entityId: announcementId }),
      );
    });
  });

  describe('updateAsHost', () => {
    it('throws NotFoundException when announcement does not belong to host', async () => {
      prisma.communityAnnouncement.findFirst.mockResolvedValue(null);

      await expect(
        service.updateAsHost(communityId, announcementId, hostId, { title: 'Updated' } as any),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
