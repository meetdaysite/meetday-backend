import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';

const PRESENCE_TTL_SECONDS = 43200; // 12 hours
const MAX_PRESENCE_AVATARS = 10;

@Injectable()
export class CommunityPresenceService {
  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  private presenceKey(communityId: string): string {
    return `community:${communityId}:online`;
  }

  async userJoined(communityId: string, userId: string): Promise<void> {
    const key = this.presenceKey(communityId);
    await this.redis.sadd(key, userId);
    await this.redis.expire(key, PRESENCE_TTL_SECONDS);
  }

  async userLeft(communityId: string, userId: string): Promise<void> {
    await this.redis.srem(this.presenceKey(communityId), userId);
  }

  async refreshTtl(communityId: string): Promise<void> {
    await this.redis.expire(this.presenceKey(communityId), PRESENCE_TTL_SECONDS);
  }

  async getPresence(communityId: string): Promise<{
    onlineCount: number;
    onlineUsers: Array<{ id: string; firstName: string; lastName: string; avatarUrl: string | null }>;
  }> {
    const userIds = await this.redis.smembers(this.presenceKey(communityId));
    const onlineCount = userIds.length;

    const sample = userIds.slice(0, MAX_PRESENCE_AVATARS);
    const users =
      sample.length > 0
        ? await this.prisma.user.findMany({
            where: { id: { in: sample } },
            select: { id: true, firstName: true, lastName: true, avatarUrl: true },
          })
        : [];

    return { onlineCount, onlineUsers: users };
  }

  async getOnlineUserIds(communityId: string): Promise<string[]> {
    return this.redis.smembers(this.presenceKey(communityId));
  }
}
