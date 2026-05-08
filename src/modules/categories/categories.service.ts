import { Injectable } from '@nestjs/common';
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

  async listPublic() {
    const cached = await this.redis.get<{ id: string; name: string; description: string | null }[]>(CATEGORIES_KEY);
    if (cached) return cached;

    const categories = await this.prisma.category.findMany({
      where: { isActive: true } as any,
      select: { id: true, name: true, description: true },
      orderBy: { name: 'asc' },
    });

    await this.redis.set(CATEGORIES_KEY, categories, CATEGORIES_TTL);
    return categories;
  }

  async invalidateCache() {
    await this.redis.del(CATEGORIES_KEY);
  }
}
