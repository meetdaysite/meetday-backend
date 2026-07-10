import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { Storage, Bucket } from '@google-cloud/storage';
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
  'application/pdf': 'pdf',
};

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

// Which content types each context accepts — narrows the DTO's global allow-list
// so e.g. opaque blobs are only valid for DM media and PDFs only for host docs.
const CONTEXT_CONTENT_TYPES: Record<UploadContext, readonly string[]> = {
  [UploadContext.EVENT_MEDIA]: [...IMAGE_TYPES, 'video/mp4'],
  [UploadContext.USER_AVATAR]: IMAGE_TYPES,
  [UploadContext.HOST_DOCUMENT]: [...IMAGE_TYPES, 'application/pdf'],
  [UploadContext.INTEREST_IMAGE]: IMAGE_TYPES,
  [UploadContext.REVIEW_PHOTO]: IMAGE_TYPES,
  [UploadContext.COMMUNITY_COVER]: IMAGE_TYPES,
  [UploadContext.COMMUNITY_ICON]: IMAGE_TYPES,
  [UploadContext.COMMUNITY_ANNOUNCEMENT]: IMAGE_TYPES,
  [UploadContext.COMMUNITY_DM_MEDIA]: IMAGE_TYPES,
  [UploadContext.COMMUNITY_FEED_MEDIA]: [...IMAGE_TYPES, 'video/mp4'],
};

// Platform-admin roles required by the admin-only contexts.
const SUPER_ADMIN_ONLY = ['SUPER_ADMIN'];
const COMMUNITY_ADMIN_ROLES = ['SUPER_ADMIN', 'CITY_ADMIN'];

@Injectable()
export class StorageService {
  private readonly bucket: Bucket;

  constructor(
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {
    const keyFile = configService.get<string | undefined>('gcs.keyFile');
    const storage = new Storage({
      projectId: configService.get<string>('gcs.projectId'),
      ...(keyFile && { keyFilename: keyFile }),
    });
    this.bucket = storage.bucket(configService.get<string>('gcs.bucket'));
  }

  async getPresignedUploadUrl(key: string, contentType: string): Promise<string> {
    const [url] = await this.bucket.file(key).getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + PRESIGN_TTL * 1000,
      contentType,
    });
    return url;
  }

  // Uploads a server-generated buffer (e.g. a rendered ticket PDF) directly to
  // GCS. Unlike requestUploadUrl, this bypasses the presigned-client-upload flow
  // — the object bytes originate on the server, not the client.
  async uploadBuffer(key: string, buffer: Buffer, contentType: string): Promise<void> {
    await this.bucket.file(key).save(buffer, { contentType, resumable: false });
  }

  async getPresignedDownloadUrl(key: string): Promise<string> {
    // OAuth providers (Google, Apple) store a full URL directly — return as-is
    if (key.startsWith('http://') || key.startsWith('https://')) return key;

    const cacheKey = `presign:${key}`;
    const cached = await this.redis.get<string>(cacheKey);
    if (cached) return cached;

    const [url] = await this.bucket.file(key).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + PRESIGN_TTL * 1000,
    });
    await this.redis.set(cacheKey, url, PRESIGN_CACHE_TTL);
    return url;
  }

  async requestUploadUrl(firebaseUid: string, dto: RequestUploadUrlDto) {
    const user = await this.prisma.user.findUnique({
      where: { firebaseUid },
      select: { id: true, role: { select: { name: true } } },
    });
    if (!user) throw new NotFoundException('User not found');
    const userId = user.id;
    const roleName = user.role?.name;

    // Narrow the globally-allowed content types to what this context accepts.
    if (!CONTEXT_CONTENT_TYPES[dto.context].includes(dto.contentType)) {
      throw new BadRequestException(
        `contentType "${dto.contentType}" is not allowed for ${dto.context}`,
      );
    }

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
        if (!SUPER_ADMIN_ONLY.includes(roleName ?? '')) {
          throw new ForbiddenException('Only a super admin can upload interest images');
        }
        if (!dto.resourceId) throw new BadRequestException('resourceId (interest UUID) is required for INTEREST_IMAGE');
        const interest = await this.prisma.interest.findUnique({ where: { id: dto.resourceId } });
        if (!interest) throw new NotFoundException('Interest not found');
        key = `interests/${dto.resourceId}/${randomUUID()}.${ext}`;
        break;
      }

      case UploadContext.REVIEW_PHOTO: {
        key = `users/${userId}/review-photos/${randomUUID()}.${ext}`;
        break;
      }

      case UploadContext.COMMUNITY_COVER:
      case UploadContext.COMMUNITY_ICON: {
        // Admin-only: only platform admins manage community media.
        if (!COMMUNITY_ADMIN_ROLES.includes(roleName ?? '')) {
          throw new ForbiddenException('Only platform admins can upload community media');
        }
        // The folder distinguishes cover vs icon based on the upload context.
        const folder = dto.context === UploadContext.COMMUNITY_COVER ? 'cover' : 'icon';

        if (dto.resourceId) {
          // Uploading to an existing community — verify it exists
          const community = await this.prisma.community.findUnique({
            where: { id: dto.resourceId },
            select: { id: true },
          });
          if (!community) throw new NotFoundException('Community not found');
          key = `communities/${dto.resourceId}/${folder}/${randomUUID()}.${ext}`;
        } else {
          // Pre-creation upload — scope to the admin user until the community exists
          key = `admins/${userId}/community-media/${folder}/${randomUUID()}.${ext}`;
        }
        break;
      }

      case UploadContext.COMMUNITY_ANNOUNCEMENT: {
        // Admin-only: announcements are authored by platform admins.
        if (!COMMUNITY_ADMIN_ROLES.includes(roleName ?? '')) {
          throw new ForbiddenException('Only platform admins can upload announcement media');
        }
        if (!dto.resourceId) {
          throw new BadRequestException('resourceId (community UUID) is required for COMMUNITY_ANNOUNCEMENT');
        }
        const community = await this.prisma.community.findUnique({
          where: { id: dto.resourceId },
          select: { id: true },
        });
        if (!community) throw new NotFoundException('Community not found');
        key = `communities/${dto.resourceId}/announcements/${randomUUID()}.${ext}`;
        break;
      }

      case UploadContext.COMMUNITY_DM_MEDIA: {
        // DM image. resourceId is the conversation id; only a participant of an
        // ACCEPTED conversation may upload. Stored as a private GCS object.
        if (!dto.resourceId) {
          throw new BadRequestException('resourceId (conversation UUID) is required for COMMUNITY_DM_MEDIA');
        }
        const convo = await this.prisma.communityDmConversation.findUnique({
          where: { id: dto.resourceId },
          select: { status: true, participant1Id: true, participant2Id: true },
        });
        if (!convo || (convo.participant1Id !== userId && convo.participant2Id !== userId)) {
          throw new NotFoundException('Conversation not found');
        }
        if (convo.status !== 'ACCEPTED') {
          throw new ForbiddenException('This conversation is not active');
        }
        key = `community-dms/${dto.resourceId}/${randomUUID()}.${ext}`;
        break;
      }

      case UploadContext.COMMUNITY_FEED_MEDIA: {
        // Feed post media. resourceId is the community id; only an ACTIVE member may upload.
        if (!dto.resourceId) {
          throw new BadRequestException('resourceId (community UUID) is required for COMMUNITY_FEED_MEDIA');
        }
        const member = await this.prisma.communityMember.findUnique({
          where: { communityId_userId: { communityId: dto.resourceId, userId } },
          select: { status: true },
        });
        if (!member || member.status !== 'ACTIVE') {
          throw new ForbiddenException('You are not an active member of this community');
        }
        key = `communities/${dto.resourceId}/feed/${randomUUID()}.${ext}`;
        break;
      }

      default:
        throw new BadRequestException('Unsupported upload context');
    }

    const uploadUrl = await this.getPresignedUploadUrl(key, dto.contentType);
    return { uploadUrl, key };
  }
}
