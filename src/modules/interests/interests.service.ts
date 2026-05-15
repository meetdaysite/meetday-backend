import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';

const INTERESTS_KEY = 'interests:public';
const INTERESTS_TTL = 300;

@Injectable()
export class InterestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async listPublic() {
    const cached = await this.redis.get<{ id: string; name: string; slug: string; image: string | null }[]>(INTERESTS_KEY);
    if (cached) return cached;

    const interests = await this.prisma.interest.findMany({
      select: { id: true, name: true, slug: true, image: true },
      orderBy: { name: 'asc' },
    });

    await this.redis.set(INTERESTS_KEY, interests, INTERESTS_TTL);
    return interests;
  }

  async invalidateCache() {
    await this.redis.del(INTERESTS_KEY);
  }
}
