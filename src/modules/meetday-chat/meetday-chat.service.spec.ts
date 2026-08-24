import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MeetdayChatService } from './meetday-chat.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';

function makePrisma() {
  const prisma: any = {
    meetdayChatThread: {
      upsert: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      // Defaults to "not dormant" so unrelated sendMyMessage tests still attempt a (mocked-away)
      // classification fetch rather than skipping silently for a different reason.
      findUnique: jest.fn().mockResolvedValue({ botDormant: false }),
    },
    meetdayChatMessage: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
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
    // Safe default so tests that don't care about the bot's classification call don't hit the
    // real network — bot-specific tests override this with their own mock.
    global.fetch = jest.fn().mockRejectedValue(new Error('fetch not mocked in this test'));

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
    it('stays silent when the thread is already dormant (handed off to a human)', async () => {
      prisma.meetdayChatThread.upsert.mockResolvedValue({ id: 'thread-1', userId: 'user-1' });
      prisma.meetdayChatMessage.create.mockResolvedValue({ id: 'msg-1', createdAt: new Date() });
      prisma.meetdayChatThread.findUnique.mockResolvedValue({ botDormant: true });
      const originalFetch = global.fetch;
      const fetchSpy = jest.fn();
      global.fetch = fetchSpy as unknown as typeof fetch;

      await service.sendMyMessage('user-1', { content: 'hello' });
      await new Promise(process.nextTick);

      expect(fetchSpy).not.toHaveBeenCalled();
      global.fetch = originalFetch;
    });

    it('replies with the greeting message when classified as GREETING', async () => {
      prisma.meetdayChatThread.upsert.mockResolvedValue({ id: 'thread-1', userId: 'user-1' });
      prisma.meetdayChatMessage.create.mockResolvedValue({ id: 'msg-1', createdAt: new Date() });
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ category: 'GREETING' }),
      } as Response);

      await service.sendMyMessage('user-1', { content: 'hi' });
      await new Promise(process.nextTick);

      expect(prisma.meetdayChatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ senderType: 'BOT', senderId: null, content: 'Hello, welcome to Meetday Support! How can we help you today?' }),
        }),
      );
      expect(prisma.meetdayChatThread.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ botDormant: true }) }));
      fetchSpy.mockRestore();
    });

    it('asks for more detail when classified as NEEDS_DETAIL', async () => {
      prisma.meetdayChatThread.upsert.mockResolvedValue({ id: 'thread-1', userId: 'user-1' });
      prisma.meetdayChatMessage.create.mockResolvedValue({ id: 'msg-1', createdAt: new Date() });
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ category: 'NEEDS_DETAIL' }),
      } as Response);

      await service.sendMyMessage('user-1', { content: 'payment issue' });
      await new Promise(process.nextTick);

      expect(prisma.meetdayChatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ senderType: 'BOT', senderId: null, content: 'Please describe your issue/query in detail.' }) }),
      );
      fetchSpy.mockRestore();
    });

    it('forces a handoff instead of asking a 3rd time when the classifier keeps returning NEEDS_DETAIL', async () => {
      prisma.meetdayChatThread.upsert.mockResolvedValue({ id: 'thread-1', userId: 'user-1' });
      prisma.meetdayChatMessage.create.mockResolvedValue({ id: 'msg-1', createdAt: new Date() });
      prisma.meetdayChatMessage.findMany.mockResolvedValue([
        { content: 'Please describe your issue/query in detail.' },
        { content: 'Please describe your issue/query in detail.' },
      ]);
      prisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ category: 'NEEDS_DETAIL' }),
      } as Response);

      await service.sendMyMessage('user-1', { content: 'issue in choosing a brand' });
      await new Promise(process.nextTick);

      expect(prisma.meetdayChatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ senderType: 'BOT', senderId: null, content: 'Thank you. Your issue has been logged. An agent will revert to you within 2 hours.' }),
        }),
      );
      expect(prisma.meetdayChatThread.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'thread-1' }, data: { botDormant: true } }),
      );
      expect(mockNotifications.create).toHaveBeenCalledTimes(1);
      fetchSpy.mockRestore();
    });

    it('logs the issue, goes dormant, and notifies admins when classified as DETAILED', async () => {
      prisma.meetdayChatThread.upsert.mockResolvedValue({ id: 'thread-1', userId: 'user-1' });
      prisma.meetdayChatMessage.create.mockResolvedValue({ id: 'msg-1', createdAt: new Date() });
      prisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }]);
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ category: 'DETAILED' }),
      } as Response);

      await service.sendMyMessage('user-1', { content: 'My deal payment failed on 20 Aug for interest #123, error code X.' });
      await new Promise(process.nextTick);

      expect(prisma.meetdayChatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            senderType: 'BOT',
            senderId: null,
            content: 'Thank you. Your issue has been logged. An agent will revert to you within 2 hours.',
          }),
        }),
      );
      expect(prisma.meetdayChatThread.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'thread-1' }, data: { botDormant: true } }),
      );
      expect(mockNotifications.create).toHaveBeenCalledTimes(2);
      expect(mockNotifications.create).toHaveBeenCalledWith(
        'admin-1',
        'meetday_chat_escalation',
        'New support issue logged',
        expect.any(String),
        { meetdayChatThreadId: 'thread-1' },
      );
      fetchSpy.mockRestore();
    });
  });
});
