import { Test } from '@nestjs/testing';
import { CategoriesService } from './categories.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePrisma() {
  return {
    category: { findMany: jest.fn() },
  };
}

function makeRedis() {
  return {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const dbCategories = [
  { id: 'cat-1', name: 'Music', description: 'Live music events' },
  { id: 'cat-2', name: 'Comedy', description: null },
];

// ── Test suite ────────────────────────────────────────────────────────────────

describe('CategoriesService', () => {
  let service: CategoriesService;
  let prisma: ReturnType<typeof makePrisma>;
  let redis: ReturnType<typeof makeRedis>;

  beforeEach(async () => {
    prisma = makePrisma();
    redis = makeRedis();

    const module = await Test.createTestingModule({
      providers: [
        CategoriesService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = module.get(CategoriesService);
    jest.clearAllMocks();
  });

  // ── listPublic ────────────────────────────────────────────────────────────

  describe('listPublic()', () => {
    it('returns cached categories without hitting the database', async () => {
      redis.get.mockResolvedValue(dbCategories);

      const result = await service.listPublic();
      expect(result).toEqual(dbCategories);
      expect(prisma.category.findMany).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('fetches from database on cache miss and populates the cache', async () => {
      redis.get.mockResolvedValue(null);
      prisma.category.findMany.mockResolvedValue(dbCategories);

      const result = await service.listPublic();
      expect(prisma.category.findMany).toHaveBeenCalledTimes(1);
      expect(redis.set).toHaveBeenCalledWith('categories:public', dbCategories, 300);
      expect(result).toEqual(dbCategories);
    });
  });

  // ── invalidateCache ───────────────────────────────────────────────────────

  describe('invalidateCache()', () => {
    it('deletes the categories cache key', async () => {
      redis.del.mockResolvedValue(undefined);
      await service.invalidateCache();
      expect(redis.del).toHaveBeenCalledWith('categories:public');
    });
  });
});
