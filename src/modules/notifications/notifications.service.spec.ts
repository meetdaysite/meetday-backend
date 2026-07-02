import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { NotificationsGateway } from './notifications.gateway';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePrisma() {
  return {
    notification: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  } as any;
}

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

const mockGateway = {
  sendToUser: jest.fn(),
};

// ── Fixtures ─────────────────────────────────────────────────────────────────

const userId = 'user-uuid';
const notifId = 'notif-uuid';

function makeNotification(overrides: Partial<any> = {}) {
  return {
    id: notifId,
    userId,
    type: 'test',
    title: 'Hello',
    body: 'World',
    isRead: false,
    readAt: null,
    metadata: null,
    createdAt: new Date(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: mockRedis },
        { provide: NotificationsGateway, useValue: mockGateway },
      ],
    }).compile();

    service = module.get(NotificationsService);
  });

  describe('create', () => {
    it('persists notification in DB', async () => {
      const notif = makeNotification();
      prisma.notification.create.mockResolvedValue(notif);

      await service.create(userId, 'test', 'Hello', 'World');

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId, type: 'test' }) }),
      );
    });

    it('invalidates the unread count cache key', async () => {
      prisma.notification.create.mockResolvedValue(makeNotification());

      await service.create(userId, 'test', 'Hello', 'World');

      expect(mockRedis.del).toHaveBeenCalledWith(`notifications:unread:${userId}`);
    });

    it('pushes notification to the WebSocket gateway', async () => {
      const notif = makeNotification();
      prisma.notification.create.mockResolvedValue(notif);

      await service.create(userId, 'test', 'Hello', 'World');

      expect(mockGateway.sendToUser).toHaveBeenCalledWith(
        userId,
        'notification',
        expect.objectContaining({ id: notif.id, title: 'Hello' }),
      );
    });
  });

  describe('findForUser', () => {
    it('returns paginated notifications for a user', async () => {
      prisma.notification.findMany.mockResolvedValue([makeNotification()]);
      prisma.notification.count
        .mockResolvedValueOnce(1)   // total
        .mockResolvedValueOnce(1);  // unreadCount

      const result = await service.findForUser(userId, { page: 1, limit: 20 });

      expect(result.notifications).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
    });

    it('filters by isRead when provided', async () => {
      prisma.notification.findMany.mockResolvedValue([]);
      prisma.notification.count.mockResolvedValue(0);

      await service.findForUser(userId, { page: 1, limit: 20, isRead: false });

      const whereArg = prisma.notification.findMany.mock.calls[0][0].where;
      expect(whereArg.isRead).toBe(false);
    });
  });

  describe('getUnreadCount', () => {
    it('returns cached count without hitting the DB', async () => {
      mockRedis.get.mockResolvedValue(5);

      const result = await service.getUnreadCount(userId);

      expect(result.count).toBe(5);
      expect(prisma.notification.count).not.toHaveBeenCalled();
    });

    it('queries DB on cache miss and stores result in cache', async () => {
      mockRedis.get.mockResolvedValue(null);
      prisma.notification.count.mockResolvedValue(3);

      const result = await service.getUnreadCount(userId);

      expect(result.count).toBe(3);
      expect(mockRedis.set).toHaveBeenCalledWith(`notifications:unread:${userId}`, 3, 30);
    });
  });

  describe('markRead', () => {
    it('throws NotFoundException when notification does not exist', async () => {
      prisma.notification.findUnique.mockResolvedValue(null);
      await expect(service.markRead(notifId, userId)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when notification belongs to another user', async () => {
      prisma.notification.findUnique.mockResolvedValue(makeNotification({ userId: 'other-user' }));
      await expect(service.markRead(notifId, userId)).rejects.toThrow(ForbiddenException);
    });

    it('returns early without updating when already read', async () => {
      prisma.notification.findUnique.mockResolvedValue(makeNotification({ isRead: true }));

      const result = await service.markRead(notifId, userId);

      expect(prisma.notification.update).not.toHaveBeenCalled();
      expect(result.message).toBe('Already read');
    });

    it('marks notification as read and invalidates cache', async () => {
      prisma.notification.findUnique.mockResolvedValue(makeNotification());

      await service.markRead(notifId, userId);

      expect(prisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: notifId }, data: expect.objectContaining({ isRead: true }) }),
      );
      expect(mockRedis.del).toHaveBeenCalledWith(`notifications:unread:${userId}`);
    });
  });

  describe('markAllRead', () => {
    it('updates all unread notifications and invalidates cache', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 4 });

      const result = await service.markAllRead(userId);

      expect(prisma.notification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId, isRead: false }, data: expect.objectContaining({ isRead: true }) }),
      );
      expect(mockRedis.del).toHaveBeenCalledWith(`notifications:unread:${userId}`);
      expect(result.message).toContain('4');
    });
  });
});
