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
import { TeamAccessService } from '../team-access/team-access.service';

const PRESIGN_TTL = 900; // 15 minutes
const PRESIGN_CACHE_TTL = 840; // cache for 14 min — always valid when served

const CONTENT_TYPE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

// Pitch-deck document types accepted for sponsorship proposals.
const PITCH_DOC_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const;

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
  [UploadContext.SPONSORSHIP_MEDIA]: IMAGE_TYPES,
  [UploadContext.SPONSORSHIP_DOCUMENT]: PITCH_DOC_TYPES,
  [UploadContext.SPONSORSHIP_CHAT_MEDIA]: [...IMAGE_TYPES, 'application/pdf'],
  [UploadContext.MEETDAY_CHAT_MEDIA]: IMAGE_TYPES,
  [UploadContext.COMMUNITY_PAST_EVENT_MEDIA]: IMAGE_TYPES,
  [UploadContext.SPONSORSHIP_DEAL_REPORT_MEDIA]: IMAGE_TYPES,
  [UploadContext.COMMUNITY_BRAND_LOGO_MEDIA]: IMAGE_TYPES,
  [UploadContext.ADMIN_ANNOUNCEMENT_ATTACHMENT]: [...IMAGE_TYPES, 'application/pdf'],
};

// Platform-admin roles required by the admin-only contexts.
const SUPER_ADMIN_ONLY = ['SUPER_ADMIN'];
const COMMUNITY_ADMIN_ROLES = ['SUPER_ADMIN', 'CITY_ADMIN'];
// Roles allowed to upload sponsorship media/documents on behalf of the "Meetday Official" host,
// mirroring the roles that can create/review sponsorship proposals from the admin panel.
const SPONSORSHIP_ADMIN_ROLES = ['SUPER_ADMIN', 'CITY_ADMIN', 'MODERATOR'];
// Identifies the system host profile admins create sponsorship proposals under, bypassing KYC.
const OFFICIAL_HOST_EMAIL = 'official@meetday.app';

@Injectable()
export class StorageService {
  private readonly bucket: Bucket;

  constructor(
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly teamAccessService: TeamAccessService,
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

  // Lists all objects under a prefix, with each object's GCS creation time. Used by the
  // orphaned-media garbage collector to age-filter candidates. autoPaginates internally.
  async listObjects(prefix: string): Promise<Array<{ key: string; timeCreated: Date }>> {
    const [files] = await this.bucket.getFiles({ prefix });
    return files.map((f) => ({
      key: f.name,
      timeCreated: f.metadata?.timeCreated ? new Date(f.metadata.timeCreated) : new Date(0),
    }));
  }

  // Best-effort batch delete. Missing objects are ignored (idempotent); per-key failures are
  // counted, not thrown, so one bad key never aborts a cleanup run.
  async deleteObjects(keys: string[]): Promise<{ deleted: number; failed: number }> {
    let deleted = 0;
    let failed = 0;
    for (const key of keys) {
      try {
        await this.bucket.file(key).delete({ ignoreNotFound: true });
        deleted++;
      } catch {
        failed++;
      }
    }
    return { deleted, failed };
  }

  // `downloadFilename`, when set, forces the browser to save the file (Content-Disposition:
  // attachment) instead of rendering it inline — used for admin-facing document downloads.
  // `ttlSeconds`, when set, overrides the default 15-minute expiry (e.g. for a link embedded as
  // static text in a generated document, where a longer-lived link is worth the tradeoff) — capped
  // at 7 days, GCS V4 signed URLs' maximum allowed validity.
  async getPresignedDownloadUrl(key: string, opts?: { downloadFilename?: string; ttlSeconds?: number }): Promise<string> {
    // OAuth providers (Google, Apple) store a full URL directly — return as-is
    if (key.startsWith('http://') || key.startsWith('https://')) return key;

    const ttlSeconds = Math.min(opts?.ttlSeconds ?? PRESIGN_TTL, 7 * 24 * 60 * 60);
    const cacheKey = opts?.downloadFilename ? `presign:${key}:dl:${opts.downloadFilename}` : `presign:${key}:ttl:${ttlSeconds}`;
    const cached = await this.redis.get<string>(cacheKey);
    if (cached) return cached;

    const [url] = await this.bucket.file(key).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + ttlSeconds * 1000,
      ...(opts?.downloadFilename && {
        responseDisposition: `attachment; filename="${opts.downloadFilename.replace(/"/g, '')}"`,
      }),
    });
    await this.redis.set(cacheKey, url, Math.max(ttlSeconds - 60, 60));
    return url;
  }


  private officialHostProfileIdCache: string | null = null;

  // Lazily creates (once) a system "Meetday Official" host profile so admins can publish
  // sponsorship proposals directly, bypassing the normal host KYC/approval flow.
  async getOrCreateOfficialHostProfileId(): Promise<string> {
    if (this.officialHostProfileIdCache) return this.officialHostProfileIdCache;

    const existing = await this.prisma.hostProfile.findFirst({
      where: { user: { email: OFFICIAL_HOST_EMAIL } },
      select: { id: true },
    });
    if (existing) {
      this.officialHostProfileIdCache = existing.id;
      return existing.id;
    }

    const hostRole = await this.prisma.role.findUniqueOrThrow({ where: { name: 'HOST' } });
    const hostProfile = await this.prisma.$transaction(async (tx) => {
      // The system user may already exist without a host profile (e.g. the profile was
      // deleted separately) — reuse it instead of blindly creating a new user, which would
      // otherwise crash on the email unique constraint.
      const user =
        (await tx.user.findFirst({ where: { email: OFFICIAL_HOST_EMAIL } })) ??
        (await tx.user.create({
          data: {
            firebaseUid: `system-${randomUUID()}`,
            email: OFFICIAL_HOST_EMAIL,
            firstName: 'Meetday',
            lastName: 'Official',
            roleId: hostRole.id,
          },
        }));

      return tx.hostProfile.create({
        data: {
          userId: user.id,
          displayName: 'Meetday',
          legalName: 'Meetday',
          approvalStatus: 'APPROVED',
          kycStatus: 'NOT_SUBMITTED',
          currentPlan: 'DISCOVER',
        },
      });
    });

    this.officialHostProfileIdCache = hostProfile.id;
    return hostProfile.id;
  }

  async requestUploadUrl(firebaseUid: string, dto: RequestUploadUrlDto) {
    const user = await this.prisma.user.findUnique({
      where: { firebaseUid },
      select: { id: true, role: { select: { name: true } }, adminRole: { select: { name: true } } },
    });
    if (!user) throw new NotFoundException('User not found');
    const userId = user.id;
    // A user's admin access can come from a secondary `adminRole` grant while their primary
    // `role` stays HOST/BRAND (see RolesGuard) — check both, not just the primary role, or a
    // primarily-HOST/BRAND admin gets wrongly rejected from admin-only upload contexts.
    const roleName = user.adminRole?.name ?? user.role?.name;

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

      case UploadContext.SPONSORSHIP_MEDIA:
      case UploadContext.SPONSORSHIP_DOCUMENT: {
        const [hostProfileId] = await this.teamAccessService.getHostProfileIds(userId);
        let sponsorshipHostProfileId: string;
        if (hostProfileId) {
          sponsorshipHostProfileId = hostProfileId;
        } else if (SPONSORSHIP_ADMIN_ROLES.includes(roleName ?? '')) {
          // Admin creating a sponsorship proposal directly — files are scoped to the system host.
          sponsorshipHostProfileId = await this.getOrCreateOfficialHostProfileId();
        } else {
          throw new NotFoundException('Host profile not found');
        }
        const folder = dto.context === UploadContext.SPONSORSHIP_MEDIA ? 'media' : 'documents';
        key = `hosts/${sponsorshipHostProfileId}/sponsorship-proposals/${folder}/${randomUUID()}.${ext}`;
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

      case UploadContext.SPONSORSHIP_CHAT_MEDIA: {
        // TriChat image. resourceId is the sponsorship interest id; only the host, the brand, or
        // an admin on an ACCEPTED thread may attach images.
        if (!dto.resourceId) {
          throw new BadRequestException('resourceId (sponsorship interest UUID) is required for SPONSORSHIP_CHAT_MEDIA');
        }
        const interest = await this.prisma.sponsorshipInterest.findUnique({
          where: { id: dto.resourceId },
          select: {
            chatStatus: true,
            hostProfileId: true,
            hostProfile: { select: { id: true } },
            sponsorshipProposal: { select: { hostProfile: { select: { id: true } } } },
            brandProfileId: true,
            brandProfile: { select: { id: true } },
            campaign: { select: { brandProfile: { select: { id: true } } } },
          },
        });
        if (!interest) throw new NotFoundException('Chat thread not found');
        const [chatHostProfileIds, chatBrandProfileIds] = await Promise.all([
          this.teamAccessService.getHostProfileIds(userId),
          this.teamAccessService.getBrandProfileIds(userId),
        ]);
        const hostProfileId = interest.hostProfileId ?? interest.hostProfile?.id ?? interest.sponsorshipProposal?.hostProfile?.id;
        const brandProfileId = interest.brandProfileId ?? interest.brandProfile?.id ?? interest.campaign?.brandProfile?.id;
        const isParticipant =
          (!!hostProfileId && chatHostProfileIds.includes(hostProfileId)) ||
          (!!brandProfileId && chatBrandProfileIds.includes(brandProfileId)) ||
          SPONSORSHIP_ADMIN_ROLES.includes(roleName ?? '');
        if (!isParticipant) throw new ForbiddenException('You do not have access to this chat');
        if (interest.chatStatus !== 'ACCEPTED') {
          throw new ForbiddenException('This chat has not been accepted yet');
        }
        key = `sponsorship-chats/${dto.resourceId}/${randomUUID()}.${ext}`;
        break;
      }

      case UploadContext.MEETDAY_CHAT_MEDIA: {
        // "Talk to Meetday" support chat image. resourceId (optional) is the thread owner's user
        // id — only relevant for an admin uploading into someone else's thread; a host/brand
        // uploading to their own thread omits it and defaults to themselves.
        const isAdmin = SPONSORSHIP_ADMIN_ROLES.includes(roleName ?? '');
        const targetUserId = dto.resourceId ?? userId;
        if (dto.resourceId && dto.resourceId !== userId && !isAdmin) {
          throw new ForbiddenException('You do not have access to this chat');
        }
        key = `meetday-chats/${targetUserId}/${randomUUID()}.${ext}`;
        break;
      }

      case UploadContext.COMMUNITY_PAST_EVENT_MEDIA: {
        // Admins can upload on behalf of a host (create/edit community profile flow) by passing
        // the target hostProfile's UUID as resourceId — hosts themselves never need to (it's
        // always their own profile, or a team member's), so resourceId is ignored for non-admins.
        const isAdmin = SPONSORSHIP_ADMIN_ROLES.includes(roleName ?? '');
        const hostProfileId =
          dto.resourceId && isAdmin
            ? (await this.prisma.hostProfile.findUnique({ where: { id: dto.resourceId }, select: { id: true } }))?.id
            : (await this.teamAccessService.getHostProfileIds(userId))[0];
        if (!hostProfileId) throw new NotFoundException('Host profile not found');
        key = `hosts/${hostProfileId}/community-profile/past-events/${randomUUID()}.${ext}`;
        break;
      }

      case UploadContext.SPONSORSHIP_DEAL_REPORT_MEDIA: {
        // Proof photos for the "Submit Report" deliverables report. resourceId is the
        // sponsorship interest id — only the host who owns it (or an admin) may attach evidence.
        if (!dto.resourceId) {
          throw new BadRequestException('resourceId (sponsorship interest UUID) is required for SPONSORSHIP_DEAL_REPORT_MEDIA');
        }
        const interest = await this.prisma.sponsorshipInterest.findUnique({
          where: { id: dto.resourceId },
          select: {
            hostProfileId: true,
            hostProfile: { select: { id: true } },
            sponsorshipProposal: { select: { hostProfile: { select: { id: true } } } },
          },
        });
        if (!interest) throw new NotFoundException('Chat thread not found');
        const hostProfileId = interest.hostProfileId ?? interest.hostProfile?.id ?? interest.sponsorshipProposal?.hostProfile?.id;
        const dealReportHostProfileIds = await this.teamAccessService.getHostProfileIds(userId);
        const isOwner =
          (!!hostProfileId && dealReportHostProfileIds.includes(hostProfileId)) ||
          SPONSORSHIP_ADMIN_ROLES.includes(roleName ?? '');
        if (!isOwner) throw new ForbiddenException('You do not own this sponsorship deal');
        key = `sponsorship-deal-reports/${dto.resourceId}/${randomUUID()}.${ext}`;
        break;
      }

      case UploadContext.COMMUNITY_BRAND_LOGO_MEDIA: {
        // Logos for the "Brands Worked With" showcase on a community profile. Admins can upload
        // on behalf of a host (create/edit community profile flow) by passing the target
        // hostProfile's UUID as resourceId — hosts themselves never need to.
        const isAdmin = SPONSORSHIP_ADMIN_ROLES.includes(roleName ?? '');
        const hostProfileId =
          dto.resourceId && isAdmin
            ? (await this.prisma.hostProfile.findUnique({ where: { id: dto.resourceId }, select: { id: true } }))?.id
            : (await this.teamAccessService.getHostProfileIds(userId))[0];
        if (!hostProfileId) throw new NotFoundException('Host profile not found');
        key = `hosts/${hostProfileId}/community-profile/brand-logos/${randomUUID()}.${ext}`;
        break;
      }

      case UploadContext.ADMIN_ANNOUNCEMENT_ATTACHMENT: {
        const isAdmin = SPONSORSHIP_ADMIN_ROLES.includes(roleName ?? '');
        if (!isAdmin) {
          throw new ForbiddenException('Only admins can upload announcement attachments');
        }
        key = `announcements/attachments/${randomUUID()}.${ext}`;
        break;
      }

      default:
        throw new BadRequestException('Unsupported upload context');
    }

    const uploadUrl = await this.getPresignedUploadUrl(key, dto.contentType);
    return { uploadUrl, key };
  }

  async getFileBuffer(key: string): Promise<Buffer> {
    const [buffer] = await this.bucket.file(key).download();
    return buffer;
  }
}
