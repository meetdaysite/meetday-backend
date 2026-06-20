import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  CommunityAccess,
  CommunityEventSource,
  CommunityMemberStatus,
  CommunityStatus,
} from '@prisma/client';
import { CommunitiesService } from './communities.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { AuditLogService } from '../audit-log/audit-log.service';

function makePrisma() {
  const prisma: any = {
    community: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), count: jest.fn() },
    communitySettings: { upsert: jest.fn() },
    communityInterest: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn() },
    communityMember: { upsert: jest.fn(), count: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), delete: jest.fn() },
    communityEvent: { upsert: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    interest: { count: jest.fn() },
    interestCategory: { findMany: jest.fn() },
    event: { findUnique: jest.fn(), findMany: jest.fn() },
    user: { findUnique: jest.fn() },
  };
  // $transaction supports the array form used by the service.
  prisma.$transaction = jest.fn().mockImplementation((ops: any[]) => Promise.all(ops));
  return prisma;
}

const mockStorage = { getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://cdn.example.com/img') };
const mockAuditLog = { log: jest.fn() };

describe('CommunitiesService', () => {
  let service: CommunitiesService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();
    const moduleRef = await Test.createTestingModule({
      providers: [
        CommunitiesService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: mockStorage },
        { provide: AuditLogService, useValue: mockAuditLog },
      ],
    }).compile();
    service = moduleRef.get(CommunitiesService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('rejects a duplicate slug', async () => {
      prisma.community.findUnique.mockResolvedValue({ id: 'other' });
      await expect(
        service.create('admin-1', { name: 'X', slug: 'taken', type: 'MEETDAY_MANAGED_PUBLIC' } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates a draft with the creator as OWNER member and persists interest tags', async () => {
      prisma.community.findUnique.mockResolvedValue(null);
      prisma.community.create.mockResolvedValue({ id: 'c1' });
      prisma.community.update.mockResolvedValue({});
      prisma.community.findFirst.mockResolvedValue({ id: 'c1', coverImageKey: null, iconKey: null });

      await service.create('admin-1', {
        name: 'X',
        slug: 'free',
        type: 'MEETDAY_MANAGED_PUBLIC',
        interestTags: ['Music', 'Nightlife'],
      } as any);

      const data = prisma.community.create.mock.calls[0][0].data;
      expect(data.members.create).toMatchObject({ userId: 'admin-1', role: 'OWNER' });
      expect(data.interestTags).toEqual(['Music', 'Nightlife']);
      expect(data.interests).toBeUndefined();
      expect(mockAuditLog.log).toHaveBeenCalled();
    });
  });

  describe('resyncEvents', () => {
    it('attaches AUTO matches without duplicating MANUAL links', async () => {
      prisma.community.findUnique.mockResolvedValue({
        id: 'c1',
        communityCities: ['Kolkata'],
        interests: [{ interestId: 'i1' }],
      });
      prisma.interestCategory.findMany.mockResolvedValue([{ categoryId: 'cat1' }]);
      prisma.event.findMany.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }]);
      prisma.communityEvent.findMany.mockResolvedValue([{ eventId: 'e1' }]); // e1 already MANUAL
      prisma.communityEvent.count.mockResolvedValue(2);
      prisma.community.update.mockResolvedValue({});

      const result = await service.resyncEvents('c1');

      const createArgs = prisma.communityEvent.createMany.mock.calls[0][0].data;
      expect(createArgs).toEqual([{ communityId: 'c1', eventId: 'e2', source: CommunityEventSource.AUTO }]);
      expect(result).toEqual({ matched: 2, attached: 1 });
    });

    it('clears AUTO links when there is nothing to match on', async () => {
      prisma.community.findUnique.mockResolvedValue({ id: 'c1', communityCities: [], interests: [] });
      prisma.communityEvent.count.mockResolvedValue(0);
      prisma.community.update.mockResolvedValue({});

      const result = await service.resyncEvents('c1');
      expect(prisma.communityEvent.deleteMany).toHaveBeenCalledWith({
        where: { communityId: 'c1', source: CommunityEventSource.AUTO },
      });
      expect(result).toEqual({ matched: 0, attached: 0 });
    });
  });

  describe('publish', () => {
    it('blocks publish when required fields are missing', async () => {
      prisma.community.findUnique.mockResolvedValue({
        id: 'c1',
        name: 'X',
        description: null,
        coverImageKey: null,
        iconKey: null,
        status: CommunityStatus.DRAFT,
        autoAddMatchingEvents: false,
        _count: { members: 1 },
      });
      await expect(service.publish('c1', 'admin-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('publishes a complete community', async () => {
      prisma.community.findUnique.mockResolvedValue({
        id: 'c1',
        name: 'X',
        description: 'desc',
        coverImageKey: 'k1',
        iconKey: 'k2',
        status: CommunityStatus.DRAFT,
        autoAddMatchingEvents: false,
        _count: { members: 2 },
      });
      prisma.community.update.mockResolvedValue({});
      prisma.community.findFirst.mockResolvedValue({ id: 'c1', coverImageKey: 'k1', iconKey: 'k2' });

      await service.publish('c1', 'admin-1');

      expect(prisma.community.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: CommunityStatus.PUBLISHED }) }),
      );
    });
  });

  describe('join', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      prisma.communityMember.findUnique.mockResolvedValue(null);
      prisma.community.update.mockResolvedValue({});
      prisma.communityMember.count.mockResolvedValue(1);
    });

    it('joins a PUBLIC community as ACTIVE', async () => {
      prisma.community.findFirst.mockResolvedValue({ id: 'c1', access: CommunityAccess.PUBLIC });
      prisma.communityMember.upsert.mockResolvedValue({ status: CommunityMemberStatus.ACTIVE });
      const res = await service.join('c1', 'firebase-uid');
      expect(res).toEqual({ status: CommunityMemberStatus.ACTIVE });
    });

    it('creates a PENDING request for APPROVAL_REQUIRED communities', async () => {
      prisma.community.findFirst.mockResolvedValue({ id: 'c1', access: CommunityAccess.APPROVAL_REQUIRED });
      prisma.communityMember.upsert.mockResolvedValue({ status: CommunityMemberStatus.PENDING });
      const res = await service.join('c1', 'firebase-uid');
      expect(res).toEqual({ status: CommunityMemberStatus.PENDING });
    });

    it('rejects joining an INVITE_ONLY community', async () => {
      prisma.community.findFirst.mockResolvedValue({ id: 'c1', access: CommunityAccess.INVITE_ONLY });
      await expect(service.join('c1', 'firebase-uid')).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
