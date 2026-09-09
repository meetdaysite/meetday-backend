import { Injectable } from '@nestjs/common';
import { CategoryType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';

const CATEGORIES_KEY = 'categories:public';
const CATEGORIES_TTL = 300;

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // Defaults to EXPERIENCE so every existing caller (host/community/event category pickers)
  // keeps seeing exactly what it saw before this param existed — SPACE is opt-in.
  async listPublic(type: CategoryType = 'EXPERIENCE') {
    const cacheKey = `${CATEGORIES_KEY}:${type}`;
    const cached = await this.redis.get<{ id: string; name: string; description: string | null }[]>(cacheKey);
    if (cached) return cached;

    const categories = await this.prisma.category.findMany({
      where: { isActive: true, type },
      select: { id: true, name: true, description: true },
      orderBy: { name: 'asc' },
    });

    await this.redis.set(cacheKey, categories, CATEGORIES_TTL);
    return categories;
  }

  async invalidateCache() {
    await this.redis.del(`${CATEGORIES_KEY}:EXPERIENCE`);
    await this.redis.del(`${CATEGORIES_KEY}:SPACE`);
  }
}
