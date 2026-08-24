import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MeetdayChatService } from './meetday-chat.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';

function makePrisma() {
  const prisma: any = {
    meetdayChatThread: { upsert: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    // Defaults to "an admin is already active" so unrelated tests don't trigger a real
    // fire-and-forget fetch to the AI service — bot-specific tests override this explicitly.
    meetdayChatMessage: {
      findMany: jest.fn().mockResolvedValue([{ senderType: 'USER', content: 'noop' }, { senderType: 'ADMIN', content: 'noop' }]),
      create: jest.fn(),
      createMany: jest.fn().mockResolvedValue({}),
    },
    user: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return prisma;
}

const mockStorage = { getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://cdn.example.com/x') };
const mockConfig = { get: jest.fn().mockReturnValue('https://ai.example.com') };
const mockNotifications = { create: jest.fn().mockResolvedValue(undefined) };

describe('MeetdayChatService', () => {
  let service: MeetdayChatService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        MeetdayChatService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: mockStorage },
        { provide: ConfigService, useValue: mockConfig },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get(MeetdayChatService);
  });

  describe('getMyChat()', () => {
    it('gets-or-creates a thread and returns messages with signed media URLs', async () => {
      prisma.meetdayChatThread.upsert.mockResolvedValue({ id: 'thread-1', userId: 'user-1' });
      prisma.meetdayChatMessage.findMany.mockResolvedValue([
        { id: 'm1', senderType: 'USER', senderId: 'user-1', content: 'hi', mediaKey: null, createdAt: new Date() },
      ]);

      const result = await service.getMyChat('user-1');

      expect(prisma.meetdayChatThread.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1' } }),
      );
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].mediaUrl).toBeNull();
    });
  });

  describe('sendMyMessage()', () => {
    it('rejects an empty message with no text and no image', async () => {
      prisma.meetdayChatThread.upsert.mockResolvedValue({ id: 'thread-1', userId: 'user-1' });
      await expect(service.sendMyMessage('user-1', {})).rejects.toThrow(BadRequestException);
    });

    it('masks personal info before saving and flags wasRedacted', async () => {
      prisma.meetdayChatThread.upsert.mockResolvedValue({ id: 'thread-1', userId: 'user-1' });
      prisma.meetdayChatMessage.create.mockResolvedValue({ id: 'msg-1', createdAt: new Date() });

      const result = await service.sendMyMessage('user-1', { content: 'call me at 9876543210' });

      expect(prisma.meetdayChatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ senderType: 'USER', senderId: 'user-1', content: expect.stringContaining('98******10') }) }),
      );
      expect(result.wasRedacted).toBe(true);
    });

    it('allows an image-only message and returns a signed mediaUrl', async () => {
      prisma.meetdayChatThread.upsert.mockResolvedValue({ id: 'thread-1', userId: 'user-1' });
      prisma.meetdayChatMessage.create.mockResolvedValue({ id: 'msg-1', createdAt: new Date() });

      const result = await service.sendMyMessage('user-1', { mediaKey: 'meetday-chats/user-1/x.jpg' });

      expect(prisma.meetdayChatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ content: '', mediaKey: 'meetday-chats/user-1/x.jpg' }) }),
      );
      expect(result.mediaUrl).toBe('https://cdn.example.com/x');
    });
  });

  describe('bot auto-reply', () => {
    it('stays silent when an admin is the most recently active sender in the thread', async () => {
      prisma.meetdayChatThread.upsert.mockResolvedValue({ id: 'thread-1', userId: 'user-1' });
      prisma.meetdayChatMessage.create.mockResolvedValue({ id: 'msg-1', createdAt: new Date() });
      prisma.meetdayChatMessage.findMany.mockResolvedValue([
        { senderType: 'USER', content: 'hello' },
        { senderType: 'ADMIN', content: 'lol' },
      ]);
      const originalFetch = global.fetch;
      const fetchSpy = jest.fn();
      global.fetch = fetchSpy as unknown as typeof fetch;

      await service.sendMyMessage('user-1', { content: 'hello' });
      await new Promise(process.nextTick);

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(prisma.meetdayChatMessage.createMany).not.toHaveBeenCalled();
      global.fetch = originalFetch;
    });

    it('answers the query and offers to bring in an agent when no admin has taken over', async () => {
      prisma.meetdayChatThread.upsert.mockResolvedValue({ id: 'thread-1', userId: 'user-1' });
      prisma.meetdayChatMessage.create.mockResolvedValue({ id: 'msg-1', createdAt: new Date() });
      prisma.meetdayChatMessage.findMany.mockResolvedValue([{ senderType: 'USER', content: 'how do sponsorships work?' }]);
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ reply: 'Here is how sponsorships work...' }),
      } as Response);

      await service.sendMyMessage('user-1', { content: 'how do sponsorships work?' });
      await new Promise(process.nextTick);

      expect(prisma.meetdayChatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ senderType: 'BOT', senderId: null, content: 'Here is how sponsorships work...' }) }),
      );
      expect(prisma.meetdayChatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ senderType: 'BOT', senderId: null, content: 'Would you like to talk to a Meetday agent?' }) }),
      );
      fetchSpy.mockRestore();
    });

    it('escalates to admins and posts the wait message when the user accepts the agent offer', async () => {
      prisma.meetdayChatThread.upsert.mockResolvedValue({ id: 'thread-1', userId: 'user-1' });
      prisma.meetdayChatMessage.create.mockResolvedValue({ id: 'msg-1', createdAt: new Date() });
      prisma.meetdayChatMessage.findMany.mockResolvedValue([
        { senderType: 'USER', content: 'yes please' },
        { senderType: 'BOT', content: 'Would you like to talk to a Meetday agent?' },
      ]);
      prisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }]);
      const originalFetch = global.fetch;
      const fetchSpy = jest.fn();
      global.fetch = fetchSpy as unknown as typeof fetch;

      await service.sendMyMessage('user-1', { content: 'yes please' });
      await new Promise(process.nextTick);

      expect(fetchSpy).not.toHaveBeenCalled(); // no fresh AI call needed, just escalate
      expect(prisma.meetdayChatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ senderType: 'BOT', senderId: null, content: 'Our support team will get back to you within 2 hours.' }),
        }),
      );
      expect(mockNotifications.create).toHaveBeenCalledTimes(2);
      expect(mockNotifications.create).toHaveBeenCalledWith(
        'admin-1',
        'meetday_chat_escalation',
        'User requested a Meetday agent',
        expect.any(String),
        { meetdayChatThreadId: 'thread-1' },
      );
      global.fetch = originalFetch;
    });

    it('treats a non-affirmative reply to the agent offer as a new question', async () => {
      prisma.meetdayChatThread.upsert.mockResolvedValue({ id: 'thread-1', userId: 'user-1' });
      prisma.meetdayChatMessage.create.mockResolvedValue({ id: 'msg-1', createdAt: new Date() });
      prisma.meetdayChatMessage.findMany.mockResolvedValue([
        { senderType: 'USER', content: 'what about refunds?' },
        { senderType: 'BOT', content: 'Would you like to talk to a Meetday agent?' },
      ]);
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ reply: 'Refunds are processed via Razorpay...' }),
      } as Response);

      await service.sendMyMessage('user-1', { content: 'what about refunds?' });
      await new Promise(process.nextTick);

      expect(fetchSpy).toHaveBeenCalled();
      expect(prisma.meetdayChatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ content: 'Refunds are processed via Razorpay...' }) }),
      );
      fetchSpy.mockRestore();
    });
  });
});
