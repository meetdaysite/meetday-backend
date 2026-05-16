import { Test } from '@nestjs/testing';
import { InterestsService } from './interests.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { StorageService } from '../../common/storage/storage.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePrisma() {
  return { interest: { findMany: jest.fn() } };
}

function makeRedis() {
  return { get: jest.fn(), set: jest.fn(), del: jest.fn() };
}

const mockStorage = { getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://cdn.example.com/interest.jpg') };

// ── Fixtures ──────────────────────────────────────────────────────────────────

const dbInterests = [
  { id: 'i1', name: 'Live Music', slug: 'live-music', description: null, image: 'interests/music.jpg' },
  { id: 'i2', name: 'Comedy', slug: 'comedy', description: 'Stand-up & improv', image: null },
];

// ── Test suite ────────────────────────────────────────────────────────────────

describe('InterestsService', () => {
  let service: InterestsService;
  let prisma: ReturnType<typeof makePrisma>;
  let redis: ReturnType<typeof makeRedis>;

  beforeEach(async () => {
    prisma = makePrisma();
    redis = makeRedis();

    const module = await Test.createTestingModule({
      providers: [
        InterestsService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: StorageService, useValue: mockStorage },
      ],
    }).compile();

    service = module.get(InterestsService);
    jest.clearAllMocks();
  });

  // ── listPublic ────────────────────────────────────────────────────────────

  describe('listPublic()', () => {
    it('returns cached interests with signed image URLs without hitting the database', async () => {
      redis.get.mockResolvedValue(dbInterests);

      const result = await service.listPublic();
      expect(prisma.interest.findMany).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
      // image should be signed
      expect(result[0].image).toBe('https://cdn.example.com/interest.jpg');
      // null image stays null
      expect(result[1].image).toBeNull();
    });

    it('fetches from database on cache miss, stores in cache, and returns signed URLs', async () => {
      redis.get.mockResolvedValue(null);
      prisma.interest.findMany.mockResolvedValue(dbInterests);

      const result = await service.listPublic();
      expect(prisma.interest.findMany).toHaveBeenCalledTimes(1);
      expect(redis.set).toHaveBeenCalledWith('interests:public', dbInterests, 300);
      expect(result[0].image).toBe('https://cdn.example.com/interest.jpg');
      expect(result[1].image).toBeNull();
    });

    it('calls getPresignedDownloadUrl only for interests that have an image', async () => {
      redis.get.mockResolvedValue(dbInterests);
      await service.listPublic();
      // Only 1 of 2 has an image
      expect(mockStorage.getPresignedDownloadUrl).toHaveBeenCalledTimes(1);
      expect(mockStorage.getPresignedDownloadUrl).toHaveBeenCalledWith('interests/music.jpg');
    });
  });

  // ── invalidateCache ───────────────────────────────────────────────────────

  describe('invalidateCache()', () => {
    it('deletes the interests cache key', async () => {
      redis.del.mockResolvedValue(undefined);
      await service.invalidateCache();
      expect(redis.del).toHaveBeenCalledWith('interests:public');
    });
  });
});
