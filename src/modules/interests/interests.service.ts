import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { StorageService } from '../../common/storage/storage.service';

const INTERESTS_KEY = 'interests:public';
const INTERESTS_TTL = 300; // 5 minutes

type InterestRow = { id: string; name: string; slug: string; description: string | null; image: string | null };

@Injectable()
export class InterestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
  ) {}

  async listPublic() {
    let interests = await this.redis.get<InterestRow[]>(INTERESTS_KEY);

    if (!interests) {
      interests = await this.prisma.interest.findMany({
        select: { id: true, name: true, slug: true, description: true, image: true },
        orderBy: { name: 'asc' },
      });
      await this.redis.set(INTERESTS_KEY, interests, INTERESTS_TTL);
    }

    return Promise.all(
      interests.map(async (interest) => ({
        ...interest,
        image: interest.image ? await this.storage.getPresignedDownloadUrl(interest.image) : null,
      })),
    );
  }

  async invalidateCache() {
    await this.redis.del(INTERESTS_KEY);
  }
}
