import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { RequestUploadUrlDto, UploadContext } from './dto/request-upload-url.dto';

const PRESIGN_TTL = 900; // 15 minutes
const PRESIGN_CACHE_TTL = 840; // cache for 14 min — always valid when served

const CONTENT_TYPE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
};

@Injectable()
export class StorageService {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {
    this.s3 = new S3Client({
      region: configService.get<string>('s3.region'),
      credentials: {
        accessKeyId: configService.get<string>('s3.accessKeyId'),
        secretAccessKey: configService.get<string>('s3.secretAccessKey'),
      },
    });
    this.bucket = configService.get<string>('s3.bucket');
  }

  getPresignedUploadUrl(key: string, contentType: string): Promise<string> {
    return getSignedUrl(
      this.s3,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: PRESIGN_TTL },
    );
  }

  async getPresignedDownloadUrl(key: string): Promise<string> {
    const cacheKey = `presign:${key}`;
    const cached = await this.redis.get<string>(cacheKey);
    if (cached) return cached;

    const url = await getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: PRESIGN_TTL },
    );
    await this.redis.set(cacheKey, url, PRESIGN_CACHE_TTL);
    return url;
  }

  async requestUploadUrl(firebaseUid: string, dto: RequestUploadUrlDto) {
    const user = await this.prisma.user.findUnique({
      where: { firebaseUid },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const userId = user.id;

    const ext = CONTENT_TYPE_EXT[dto.contentType];
    let key: string;

    switch (dto.context) {
      case UploadContext.EVENT_MEDIA: {
        if (!dto.mediaType) throw new BadRequestException('mediaType is required for EVENT_MEDIA');

        if (dto.resourceId) {
          // Uploading to an existing event — verify ownership
          const event = await this.prisma.event.findUnique({
            where: { id: dto.resourceId },
            include: { hostProfile: { select: { userId: true } } },
          });
          if (!event) throw new NotFoundException('Event not found');
          if (event.hostProfile.userId !== userId) throw new ForbiddenException('You do not own this event');
          key = `events/${dto.resourceId}/${dto.mediaType.toLowerCase()}/${randomUUID()}.${ext}`;
        } else {
          // Pre-creation upload — scope to host profile so event ID is not required yet
          const hostProfile = await this.prisma.hostProfile.findUnique({ where: { userId } });
          if (!hostProfile) throw new NotFoundException('Host profile not found');
          key = `hosts/${hostProfile.id}/event-media/${dto.mediaType.toLowerCase()}/${randomUUID()}.${ext}`;
        }
        break;
      }

      case UploadContext.USER_AVATAR: {
        key = `users/${userId}/avatar/${randomUUID()}.${ext}`;
        break;
      }

      case UploadContext.HOST_DOCUMENT: {
        const hostProfile = await this.prisma.hostProfile.findUnique({ where: { userId } });
        if (!hostProfile) throw new NotFoundException('Host profile not found');
        key = `hosts/${hostProfile.id}/documents/${randomUUID()}.${ext}`;
        break;
      }

      case UploadContext.INTEREST_IMAGE: {
        if (!dto.resourceId) throw new BadRequestException('resourceId (interest UUID) is required for INTEREST_IMAGE');
        const interest = await this.prisma.interest.findUnique({ where: { id: dto.resourceId } });
        if (!interest) throw new NotFoundException('Interest not found');
        key = `interests/${dto.resourceId}/${randomUUID()}.${ext}`;
        break;
      }
    }

    const uploadUrl = await this.getPresignedUploadUrl(key, dto.contentType);
    return { uploadUrl, key };
  }
}
