import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MeetdayChatService } from './meetday-chat.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';

function makePrisma() {
  const prisma: any = {
    meetdayChatThread: { upsert: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    meetdayChatMessage: { findMany: jest.fn(), findFirst: jest.fn().mockResolvedValue({ id: 'admin-msg-1' }), create: jest.fn(), createMany: jest.fn().mockResolvedValue({}) },
  };
  return prisma;
}

const mockStorage = { getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://cdn.example.com/x') };
const mockConfig = { get: jest.fn().mockReturnValue('https://ai.example.com') };

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
    it('does not attempt a bot reply once an admin has replied in the thread', async () => {
      prisma.meetdayChatThread.upsert.mockResolvedValue({ id: 'thread-1', userId: 'user-1' });
      prisma.meetdayChatMessage.create.mockResolvedValue({ id: 'msg-1', createdAt: new Date() });
      prisma.meetdayChatMessage.findFirst.mockResolvedValue({ id: 'admin-msg-1' });
      const fetchSpy = jest.spyOn(global, 'fetch');

      await service.sendMyMessage('user-1', { content: 'hello' });
      await new Promise(process.nextTick);

      expect(prisma.meetdayChatMessage.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { threadId: 'thread-1', senderType: 'ADMIN' } }),
      );
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it('creates two BOT messages (answer + follow-up) when no admin has replied yet', async () => {
      prisma.meetdayChatThread.upsert.mockResolvedValue({ id: 'thread-1', userId: 'user-1' });
      prisma.meetdayChatMessage.create.mockResolvedValue({ id: 'msg-1', createdAt: new Date() });
      prisma.meetdayChatMessage.findFirst.mockResolvedValue(null);
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ reply: 'Here is how sponsorships work...' }),
      } as Response);

      await service.sendMyMessage('user-1', { content: 'how do sponsorships work?' });
      await new Promise(process.nextTick);

      expect(prisma.meetdayChatMessage.createMany).toHaveBeenCalledWith({
        data: [
          { threadId: 'thread-1', senderType: 'BOT', senderId: null, content: 'Here is how sponsorships work...' },
          { threadId: 'thread-1', senderType: 'BOT', senderId: null, content: expect.stringContaining('2 hours') },
        ],
      });
      fetchSpy.mockRestore();
    });
  });
});
