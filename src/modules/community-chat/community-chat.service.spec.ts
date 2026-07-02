import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CommunityChatService } from './community-chat.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePrisma() {
  const prisma: any = {
    channelMessage: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    communityMember: {
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  prisma.$transaction = jest.fn().mockImplementation(async (fn: any) => fn(prisma));
  return prisma;
}

const mockAuditLog = { log: jest.fn() };

// ── Fixtures ─────────────────────────────────────────────────────────────────

const channelId = 'channel-uuid';
const communityId = 'community-uuid';
const senderId = 'user-uuid';
const messageId = 'message-uuid';
const parentId = 'parent-uuid';

function makeMessage(overrides: Partial<any> = {}) {
  return {
    id: messageId,
    channelId,
    communityId,
    senderId,
    content: 'Hello!',
    isPinned: false,
    pinnedAt: null,
    pinnedBy: null,
    parentMessageId: null,
    replyCount: 0,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    sender: { id: senderId, firstName: 'Alice', lastName: 'Smith', avatarUrl: null },
    pinnedByUser: null,
    reactions: [],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CommunityChatService', () => {
  let service: CommunityChatService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        CommunityChatService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: mockAuditLog },
      ],
    }).compile();

    service = module.get(CommunityChatService);
  });

  describe('createMessage', () => {
    it('throws NotFoundException when parent message does not exist', async () => {
      prisma.channelMessage.findFirst.mockResolvedValue(null);

      await expect(
        service.createMessage(channelId, communityId, senderId, 'Reply!', parentId),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates a top-level message without a parentMessageId', async () => {
      const msg = makeMessage();
      prisma.channelMessage.create.mockResolvedValue(msg);
      prisma.communityMember.findFirst.mockResolvedValue({ id: 'member-uuid' });

      const result = await service.createMessage(channelId, communityId, senderId, 'Hello!');

      expect(prisma.channelMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ channelId, communityId, senderId, content: 'Hello!', parentMessageId: undefined }),
        }),
      );
      expect(result).toMatchObject({ id: messageId });
    });

    it('creates a reply and increments the parent reply count', async () => {
      prisma.channelMessage.findFirst.mockResolvedValue({ id: parentId });
      const reply = makeMessage({ parentMessageId: parentId });
      prisma.channelMessage.create.mockResolvedValue(reply);
      prisma.channelMessage.update.mockResolvedValue({});
      prisma.communityMember.findFirst.mockResolvedValue({ id: 'member-uuid' });

      await service.createMessage(channelId, communityId, senderId, 'Reply!', parentId);

      expect(prisma.channelMessage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: parentId },
          data: { replyCount: { increment: 1 } },
        }),
      );
    });
  });

  describe('softDeleteMessage', () => {
    it('throws NotFoundException when message does not exist', async () => {
      prisma.channelMessage.findFirst.mockResolvedValue(null);

      await expect(service.softDeleteMessage(messageId, channelId, senderId, 'MEMBER' as any)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when a non-sender non-moderator tries to delete', async () => {
      prisma.channelMessage.findFirst.mockResolvedValue(makeMessage({ senderId: 'other-user' }));
      prisma.communityMember.updateMany.mockResolvedValue({});

      await expect(service.softDeleteMessage(messageId, channelId, senderId, 'MEMBER' as any)).rejects.toThrow(ForbiddenException);
    });

    it('allows the sender to soft-delete their own message', async () => {
      prisma.channelMessage.findFirst.mockResolvedValue(makeMessage());
      prisma.channelMessage.update.mockResolvedValue(makeMessage({ deletedAt: new Date() }));
      prisma.communityMember.updateMany.mockResolvedValue({});

      await service.softDeleteMessage(messageId, channelId, senderId, 'MEMBER' as any);

      expect(prisma.channelMessage.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
      );
    });

    it('allows a moderator to delete any message and logs audit', async () => {
      prisma.channelMessage.findFirst.mockResolvedValue(makeMessage({ senderId: 'other-user' }));
      prisma.channelMessage.update.mockResolvedValue(makeMessage({ deletedAt: new Date() }));
      prisma.communityMember.updateMany.mockResolvedValue({});

      await service.softDeleteMessage(messageId, channelId, senderId, 'MODERATOR' as any);

      expect(prisma.channelMessage.update).toHaveBeenCalled();
      expect(mockAuditLog.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'CHAT_MESSAGE_DELETED_BY_MOD' }));
    });
  });
});
