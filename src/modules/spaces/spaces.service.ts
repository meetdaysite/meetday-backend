import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Prisma, SpaceChatSenderType, SpaceInterestRequesterType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { TeamAccessService } from '../../common/team-access/team-access.service';
import { ADMIN_ALERT_EMAILS } from '../../common/mail/admin-recipients.constant';
import { redactPersonalInfo } from '../../common/utils/redact-personal-info.util';
import { UpdateSpaceProfileDto } from './dto/update-space-profile.dto';
import { ActivateSpaceCommunityDto } from './dto/activate-space-community.dto';
import { CreateSpaceInterestDto } from './dto/create-space-interest.dto';
import { ListSpaceChatsQueryDto } from './dto/list-space-chats-query.dto';
import { SendSpaceChatMessageDto } from './dto/send-space-chat-message.dto';

type PastEventLike = { name?: string; description?: string; imageKeys?: string[] };
type BrandWorkedWithLike = { brandName?: string; logoKey?: string; url?: string };

@Injectable()
export class SpacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    @InjectQueue('mail') private readonly mailQueue: Queue,
    private readonly notificationsService: NotificationsService,
    private readonly auditLogService: AuditLogService,
    private readonly teamAccessService: TeamAccessService,
  ) {}

  async getMe(userId: string) {
    const spaceProfile = await this.prisma.spaceProfile.findUnique({
      where: { userId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            phone: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
            isActive: true,
          },
        },
      },
    });

    if (!spaceProfile) {
      throw new NotFoundException('Space Partner profile not found');
    }

    return spaceProfile;
  }

  async updateProfile(userId: string, dto: UpdateSpaceProfileDto) {
    const existing = await this.prisma.spaceProfile.findUnique({ where: { userId } });
    if (!existing) {
      throw new NotFoundException('Space Partner profile not found');
    }

    const updated = await this.prisma.spaceProfile.update({
      where: { userId },
      data: {
        ...(dto.businessName !== undefined && { businessName: dto.businessName }),
        ...(dto.operatingCities !== undefined && { operatingCities: dto.operatingCities }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            phone: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
          },
        },
      },
    });

    return updated;
  }

  private async withPastEventImageUrls(pastEvents: PastEventLike[] | null | undefined) {
    if (!pastEvents || !Array.isArray(pastEvents)) return [];
    return Promise.all(
      pastEvents.map(async (event) => ({
        name: event?.name ?? null,
        description: event?.description ?? null,
        imageKeys: event?.imageKeys ?? [],
        imageUrls: await Promise.all(
          (event?.imageKeys ?? []).map((key) => this.storageService.getPresignedDownloadUrl(key)),
        ),
      })),
    );
  }

  private async withBrandsWorkedWithLogoUrls(brandsWorkedWith: BrandWorkedWithLike[] | null | undefined) {
    if (!brandsWorkedWith || !Array.isArray(brandsWorkedWith)) return [];
    return Promise.all(
      brandsWorkedWith.map(async (brand) => ({
        brandName: brand?.brandName ?? null,
        logoKey: brand?.logoKey ?? null,
        url: brand?.url ?? null,
        logoUrl: brand?.logoKey ? await this.storageService.getPresignedDownloadUrl(brand.logoKey) : null,
      })),
    );
  }

  private async withSpaceCommunityMediaUrls(profile: {
    logoKey: string;
    posterKey?: string | null;
    centreShowcaseImageKeys?: string[];
    pendingRevision?: Prisma.JsonValue;
    pastEvents?: Prisma.JsonValue;
    brandsWorkedWith?: Prisma.JsonValue;
    categories: { category: { id: string; name: string } }[];
    [key: string]: unknown;
  }) {
    const { categories, ...rest } = profile;
    const [logoUrl, posterUrl, centreShowcaseUrls] = await Promise.all([
      profile.logoKey ? this.storageService.getPresignedDownloadUrl(profile.logoKey) : null,
      profile.posterKey ? this.storageService.getPresignedDownloadUrl(profile.posterKey) : null,
      Promise.all((profile.centreShowcaseImageKeys ?? []).map((key) => this.storageService.getPresignedDownloadUrl(key))),
    ]);

    let pendingRevision = profile.pendingRevision as
      | (Record<string, unknown> & {
          logoKey?: string;
          posterKey?: string;
          pastEvents?: PastEventLike[];
          brandsWorkedWith?: BrandWorkedWithLike[];
        })
      | null
      | undefined;
    if (pendingRevision) {
      const [revisionLogoUrl, revisionPosterUrl, revisionPastEvents, revisionBrandsWorkedWith] = await Promise.all([
        pendingRevision.logoKey ? this.storageService.getPresignedDownloadUrl(pendingRevision.logoKey) : undefined,
        pendingRevision.posterKey ? this.storageService.getPresignedDownloadUrl(pendingRevision.posterKey) : undefined,
        this.withPastEventImageUrls(pendingRevision.pastEvents),
        this.withBrandsWorkedWithLogoUrls(pendingRevision.brandsWorkedWith),
      ]);
      pendingRevision = {
        ...pendingRevision,
        logoUrl: revisionLogoUrl,
        posterUrl: revisionPosterUrl,
        pastEvents: revisionPastEvents,
        brandsWorkedWith: revisionBrandsWorkedWith,
      };
    }

    return {
      ...rest,
      logoUrl,
      posterUrl,
      centreShowcaseUrls,
      pendingRevision: pendingRevision ?? null,
      pastEvents: await this.withPastEventImageUrls(profile.pastEvents as PastEventLike[] | undefined),
      brandsWorkedWith: await this.withBrandsWorkedWithLogoUrls(profile.brandsWorkedWith as BrandWorkedWithLike[] | undefined),
      categories: categories.map((c) => c.category),
    };
  }

  async getCommunityProfile(userId: string) {
    const spaceProfile = await this.prisma.spaceProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!spaceProfile) throw new NotFoundException('Space Partner profile not found');

    const communityProfile = await this.prisma.spaceCommunityProfile.findUnique({
      where: { spaceProfileId: spaceProfile.id },
      include: { categories: { include: { category: true } } },
    });
    if (!communityProfile) return null;

    return this.withSpaceCommunityMediaUrls(communityProfile);
  }

  // A brand-new or not-yet-approved (PENDING/REJECTED) profile is edited directly and reset
  // to PENDING. An already-APPROVED profile's edits are staged as a `pendingRevision` snapshot
  // instead — mirrors HostsService.activateCommunityProfile exactly.
  async activateCommunityProfile(userId: string, dto: ActivateSpaceCommunityDto) {
    const spaceProfile = await this.prisma.spaceProfile.findUnique({
      where: { userId },
      select: { id: true, businessName: true, user: { select: { firstName: true } } },
    });
    if (!spaceProfile) throw new NotFoundException('Space Partner profile not found');

    const validCategories = await this.prisma.category.findMany({
      where: { id: { in: dto.categoryIds }, type: 'SPACE' },
      select: { id: true },
    });
    if (validCategories.length !== dto.categoryIds.length) {
      throw new BadRequestException('One or more category IDs are invalid');
    }

    const existing = await this.prisma.spaceCommunityProfile.findUnique({
      where: { spaceProfileId: spaceProfile.id },
      select: { id: true, approvalStatus: true },
    });

    let communityProfile: { id: string; name: string };
    let isRevision = false;

    if (existing && existing.approvalStatus === 'APPROVED') {
      isRevision = true;
      communityProfile = await this.prisma.spaceCommunityProfile.update({
        where: { id: existing.id },
        data: { pendingRevision: JSON.parse(JSON.stringify(dto)) as Prisma.InputJsonValue },
      });
    } else {
      const { categoryIds, pastEvents, brandsWorkedWith, ...fields } = dto;
      const pastEventsJson =
        pastEvents !== undefined ? (JSON.parse(JSON.stringify(pastEvents)) as Prisma.InputJsonValue) : Prisma.JsonNull;
      const brandsWorkedWithJson =
        brandsWorkedWith !== undefined
          ? (JSON.parse(JSON.stringify(brandsWorkedWith)) as Prisma.InputJsonValue)
          : Prisma.JsonNull;
      communityProfile = await this.prisma.spaceCommunityProfile.upsert({
        where: { spaceProfileId: spaceProfile.id },
        create: { ...fields, spaceProfileId: spaceProfile.id, pastEvents: pastEventsJson, brandsWorkedWith: brandsWorkedWithJson },
        update: {
          ...fields,
          pastEvents: pastEventsJson,
          brandsWorkedWith: brandsWorkedWithJson,
          approvalStatus: 'PENDING',
          adminRejectionRemark: null,
          reviewedBy: null,
          reviewedAt: null,
        },
      });

      await this.prisma.$transaction([
        this.prisma.spaceCommunityProfileCategory.deleteMany({ where: { spaceCommunityProfileId: communityProfile.id } }),
        this.prisma.spaceCommunityProfileCategory.createMany({
          data: categoryIds.map((categoryId) => ({ spaceCommunityProfileId: communityProfile.id, categoryId })),
        }),
      ]);
    }

    const admins = await this.prisma.user.findMany({
      where: { isActive: true, role: { name: { in: ['SUPER_ADMIN', 'CITY_ADMIN', 'MODERATOR'] } } },
      select: { id: true, email: true },
    });
    void Promise.allSettled(
      admins.map((admin) =>
        this.notificationsService.create(
          admin.id,
          isRevision ? 'space_profile_revision_submitted' : 'space_profile_pending_review',
          isRevision ? 'Community Space edit pending review' : 'Community Space pending review',
          isRevision
            ? `An edit to "${communityProfile.name}" is awaiting approval.`
            : `"${communityProfile.name}" is awaiting approval.`,
          { spaceCommunityProfileId: communityProfile.id },
        ),
      ),
    );

    for (const to of ADMIN_ALERT_EMAILS) {
      void this.mailQueue
        .add('community-profile-submitted', {
          to,
          hostName: spaceProfile.user.firstName,
          communityName: communityProfile.name,
        })
        .catch(() => undefined);
    }

    this.auditLogService.log({
      actorId: userId,
      actorRole: 'SPACE_PARTNER',
      action: isRevision ? 'SPACE_PROFILE_REVISION_SUBMITTED' : 'SPACE_PROFILE_SUBMITTED',
      entityType: 'SPACE_COMMUNITY_PROFILE',
      entityId: communityProfile.id,
      metadata: { isRevision },
    });

    return this.getCommunityProfile(userId);
  }

  async deactivateCommunityProfile(userId: string) {
    const spaceProfile = await this.prisma.spaceProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!spaceProfile) throw new NotFoundException('Space Partner profile not found');

    await this.prisma.spaceCommunityProfile.deleteMany({ where: { spaceProfileId: spaceProfile.id } });
  }

  // Public-ish browse list for brands/communities — admin-approved and not admin-hidden spaces
  // only, mirrors SponsorshipService.listApprovedCommunities' shape/pattern for host communities.
  async listApprovedCommunities() {
    const profiles = await this.prisma.spaceCommunityProfile.findMany({
      where: { approvalStatus: 'APPROVED', isHidden: false },
      select: {
        id: true,
        spaceProfileId: true,
        name: true,
        about: true,
        logoKey: true,
        posterKey: true,
        numberOfVenues: true,
        venueCapacity: true,
        communitySize: true,
        experiencesPerYear: true,
        activeLocations: true,
        centreShowcaseImageKeys: true,
        videoLink: true,
        pastEvents: true,
        brandsWorkedWith: true,
        categories: { select: { category: { select: { id: true, name: true } } } },
        spaceProfile: {
          select: {
            businessName: true,
            operatingCities: true,
            socialLinks: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const spaces = await Promise.all(
      profiles.map(async ({ logoKey, posterKey, centreShowcaseImageKeys, categories, spaceProfile, pastEvents, brandsWorkedWith, ...rest }) => ({
        ...rest,
        logoUrl: logoKey ? await this.storageService.getPresignedDownloadUrl(logoKey) : null,
        posterUrl: posterKey ? await this.storageService.getPresignedDownloadUrl(posterKey) : null,
        centreShowcaseUrls: await Promise.all(
          (centreShowcaseImageKeys ?? []).map((key) => this.storageService.getPresignedDownloadUrl(key)),
        ),
        categories: categories.map((c) => c.category),
        businessName: spaceProfile?.businessName ?? null,
        operatingCities: spaceProfile?.operatingCities ?? [],
        socialLinks: spaceProfile?.socialLinks ?? null,
        pastEvents: await this.withPastEventImageUrls(pastEvents as PastEventLike[] | null),
        brandsWorkedWith: await this.withBrandsWorkedWithLogoUrls(brandsWorkedWith as BrandWorkedWithLike[] | null),
      })),
    );

    return { spaces, total: spaces.length };
  }

  // ── Community Space interest + chat (Brand/Community ↔ Space Partner) ──────────────────
  // Simpler cousin of SponsorshipService's TriChat: request -> accept/decline -> chat. No
  // deal/payment lifecycle — spaces are booked/negotiated entirely within the chat itself.

  private async getOwnSpaceRelatedProfiles(userId: string) {
    const [hostProfileIds, brandProfileIds, spaceProfile] = await Promise.all([
      this.teamAccessService.getHostProfileIds(userId),
      this.teamAccessService.getBrandProfileIds(userId),
      this.prisma.spaceProfile.findUnique({ where: { userId }, select: { id: true } }),
    ]);
    return {
      hostProfileId: hostProfileIds[0] ?? null,
      brandProfileId: brandProfileIds[0] ?? null,
      spaceProfileId: spaceProfile?.id ?? null,
    };
  }

  // Brand or Community expresses interest in a Community Space — idempotent, notifies the
  // space partner (who decides whether to accept) and confirms back to the requester.
  async markSpaceInterest(userId: string, spaceCommunityProfileId: string, dto: CreateSpaceInterestDto) {
    const space = await this.prisma.spaceCommunityProfile.findUnique({
      where: { id: spaceCommunityProfileId },
      select: { id: true, name: true, approvalStatus: true, isHidden: true, spaceProfile: { select: { userId: true } } },
    });
    if (!space || space.approvalStatus !== 'APPROVED' || space.isHidden) {
      throw new NotFoundException('Community Space not found');
    }

    const { hostProfileId, brandProfileId } = await this.getOwnSpaceRelatedProfiles(userId);
    if (!hostProfileId && !brandProfileId) {
      throw new BadRequestException('Only brand or community accounts can express interest in a Community Space');
    }
    // An account with BOTH a brand and a community profile (rare, but real — e.g. a test
    // account) is otherwise ambiguous: `dto.asRole` tells us which dashboard the click actually
    // came from, so it isn't silently misfiled as the other type. Falls back to brand-first only
    // when the caller didn't say (older clients / genuinely single-profile accounts).
    const requesterType: SpaceInterestRequesterType =
      dto.asRole === 'COMMUNITY' && hostProfileId
        ? 'COMMUNITY'
        : dto.asRole === 'BRAND' && brandProfileId
          ? 'BRAND'
          : brandProfileId
            ? 'BRAND'
            : 'COMMUNITY';

    const existing = await this.prisma.spaceInterest.findUnique({
      where:
        requesterType === 'BRAND'
          ? { spaceCommunityProfileId_brandProfileId: { spaceCommunityProfileId, brandProfileId: brandProfileId! } }
          : { spaceCommunityProfileId_hostProfileId: { spaceCommunityProfileId, hostProfileId: hostProfileId! } },
    });
    if (existing) {
      return { message: 'Already interested', alreadyInterested: true, interestId: existing.id, chatStatus: existing.chatStatus };
    }

    const interest = await this.prisma.spaceInterest.create({
      data: {
        spaceCommunityProfileId,
        requesterType,
        brandProfileId: requesterType === 'BRAND' ? brandProfileId : null,
        hostProfileId: requesterType === 'COMMUNITY' ? hostProfileId : null,
        message: dto.message?.trim() || null,
      },
    });

    void this.notificationsService
      .create(
        space.spaceProfile.userId,
        'space_interest_requested',
        'New interest in your Community Space',
        `A ${requesterType === 'BRAND' ? 'brand' : 'community'} is interested — check your Chats to respond.`,
        { spaceInterestId: interest.id, spaceCommunityProfileId },
      )
      .catch(() => undefined);

    void this.notificationsService
      .create(userId, 'space_interest_confirmed', 'Interest sent!', `${space.name} has been notified of your interest.`, {
        spaceInterestId: interest.id,
      })
      .catch(() => undefined);

    return { message: 'Interest recorded', alreadyInterested: false, interestId: interest.id, chatStatus: interest.chatStatus };
  }

  async listMySpaceChats(userId: string, query: ListSpaceChatsQueryDto) {
    const { hostProfileId, brandProfileId, spaceProfileId } = await this.getOwnSpaceRelatedProfiles(userId);
    const role = query.role ?? (spaceProfileId ? 'SPACE' : brandProfileId ? 'BRAND' : hostProfileId ? 'COMMUNITY' : null);
    if (!role) throw new NotFoundException('No brand, community, or space profile found for this account');
    // Guard against a null profile id silently matching Prisma's "is null" semantics and
    // returning someone ELSE's rows (e.g. every brand-side interest has hostProfileId=null) —
    // fail loudly instead of leaking/hiding data when the caller lacks the profile for `role`.
    if (role === 'SPACE' && !spaceProfileId) throw new NotFoundException("You don't have a Space Partner profile on this account");
    if (role === 'BRAND' && !brandProfileId) throw new NotFoundException("You don't have a Brand profile on this account");
    if (role === 'COMMUNITY' && !hostProfileId) throw new NotFoundException("You don't have a Community profile on this account");

    const where: Prisma.SpaceInterestWhereInput = {
      ...(query.status && { chatStatus: query.status }),
      ...(role === 'SPACE'
        ? { spaceCommunityProfile: { spaceProfileId: spaceProfileId! } }
        : role === 'BRAND'
          ? { brandProfileId: brandProfileId! }
          : { hostProfileId: hostProfileId! }),
    };

    const interests = await this.prisma.spaceInterest.findMany({
      where,
      include: {
        spaceCommunityProfile: { select: { id: true, name: true, logoKey: true } },
        brandProfile: { select: { id: true, brandName: true, logoKey: true } },
        hostProfile: { select: { id: true, displayName: true, communityProfile: { select: { name: true, logoKey: true } } } },
        chatMessages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true, mediaKey: true, senderType: true, createdAt: true },
        },
      },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
    });

    const mySenderType: SpaceChatSenderType = role === 'SPACE' ? 'SPACE' : role === 'BRAND' ? 'BRAND' : 'COMMUNITY';

    const threads = await Promise.all(
      interests.map(async (i) => {
        const lastReadAt = role === 'SPACE' ? i.spaceLastReadAt : i.requesterLastReadAt;
        const unreadCount = await this.prisma.spaceChatMessage.count({
          where: {
            spaceInterestId: i.id,
            senderType: { not: mySenderType },
            deletedAt: null,
            ...(lastReadAt && { createdAt: { gt: lastReadAt } }),
          },
        });

        let counterpartName: string;
        let counterpartLogoKey: string | null;
        if (role === 'SPACE') {
          counterpartName = i.requesterType === 'BRAND' ? (i.brandProfile?.brandName ?? 'Brand') : (i.hostProfile?.communityProfile?.name ?? i.hostProfile?.displayName ?? 'Community');
          counterpartLogoKey = i.requesterType === 'BRAND' ? (i.brandProfile?.logoKey ?? null) : (i.hostProfile?.communityProfile?.logoKey ?? null);
        } else {
          counterpartName = i.spaceCommunityProfile.name;
          counterpartLogoKey = i.spaceCommunityProfile.logoKey;
        }

        const lastMsg = i.chatMessages[0];
        return {
          id: i.id,
          spaceCommunityProfileId: i.spaceCommunityProfileId,
          requesterType: i.requesterType,
          chatStatus: i.chatStatus,
          createdAt: i.createdAt,
          chatAcceptedAt: i.chatAcceptedAt,
          lastMessageAt: i.lastMessageAt,
          lastMessagePreview: lastMsg ? (lastMsg.content || (lastMsg.mediaKey ? '📷 Photo' : '')).slice(0, 120) : (i.message ?? null),
          unreadCount,
          counterpartName,
          counterpartAvatarUrl: counterpartLogoKey ? await this.storageService.getPresignedDownloadUrl(counterpartLogoKey) : null,
        };
      }),
    );

    return threads;
  }

  // Verifies the caller is a participant (the space, or the requesting brand/community) and
  // returns which "hat" they're wearing — mirrors SponsorshipService.getInterestForParticipant.
  private async getSpaceInterestForParticipant(userId: string, interestId: string, preferredRole?: 'BRAND' | 'COMMUNITY' | 'SPACE') {
    const interest = await this.prisma.spaceInterest.findUnique({
      where: { id: interestId },
      include: {
        spaceCommunityProfile: {
          select: { id: true, name: true, logoKey: true, spaceProfileId: true, spaceProfile: { select: { userId: true } } },
        },
        brandProfile: { select: { id: true, userId: true, brandName: true } },
        hostProfile: { select: { id: true, userId: true, displayName: true, communityProfile: { select: { name: true } } } },
      },
    });
    if (!interest) throw new NotFoundException('Chat thread not found');

    let isSpace = interest.spaceCommunityProfile.spaceProfile.userId === userId;
    let isBrand = interest.brandProfile?.userId === userId;
    let isHost = interest.hostProfile?.userId === userId;
    if (!isSpace && !isBrand && !isHost) {
      const [hostProfileIds, brandProfileIds] = await Promise.all([
        this.teamAccessService.getHostProfileIds(userId),
        this.teamAccessService.getBrandProfileIds(userId),
      ]);
      isBrand = !!interest.brandProfileId && brandProfileIds.includes(interest.brandProfileId);
      isHost = !!interest.hostProfileId && hostProfileIds.includes(interest.hostProfileId);
    }
    if (!isSpace && !isBrand && !isHost) throw new ForbiddenException('You do not have access to this chat');

    const senderType: SpaceChatSenderType = preferredRole
      ? SpaceChatSenderType[preferredRole]
      : isSpace
        ? SpaceChatSenderType.SPACE
        : isBrand
          ? SpaceChatSenderType.BRAND
          : SpaceChatSenderType.COMMUNITY;

    return { interest, isSpace, isBrand, isHost, senderType };
  }

  async listSpaceChatMessages(userId: string, interestId: string, preferredRole?: 'BRAND' | 'COMMUNITY' | 'SPACE') {
    const { interest, senderType } = await this.getSpaceInterestForParticipant(userId, interestId, preferredRole);

    const messages = await this.prisma.spaceChatMessage.findMany({
      where: { spaceInterestId: interest.id },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: { id: true, senderType: true, senderId: true, content: true, mediaKey: true, deletedAt: true, createdAt: true },
    });

    const withMediaUrls = await Promise.all(
      messages.map(async ({ mediaKey, deletedAt, ...m }) => {
        if (deletedAt) return { ...m, content: '', mediaUrl: null, deletedAt };
        return { ...m, deletedAt: null, mediaUrl: mediaKey ? await this.storageService.getPresignedDownloadUrl(mediaKey) : null };
      }),
    );

    void this.prisma.spaceInterest
      .update({
        where: { id: interest.id },
        data: senderType === SpaceChatSenderType.SPACE ? { spaceLastReadAt: new Date() } : { requesterLastReadAt: new Date() },
      })
      .catch(() => undefined);

    return { messages: withMediaUrls, chatStatus: interest.chatStatus };
  }

  async sendSpaceChatMessage(userId: string, interestId: string, dto: SendSpaceChatMessageDto) {
    const { interest, senderType } = await this.getSpaceInterestForParticipant(userId, interestId);
    if (interest.chatStatus !== 'ACCEPTED') {
      throw new BadRequestException('The space must accept this request before you can chat.');
    }
    if (!dto.content?.trim() && !dto.mediaKey) {
      throw new BadRequestException('Message must have text or an image');
    }

    // Contact info must stay off-platform — same redaction rule as sponsorship chat.
    const { content, wasRedacted } = dto.content ? redactPersonalInfo(dto.content) : { content: '', wasRedacted: false };

    const message = await this.prisma.spaceChatMessage.create({
      data: { spaceInterestId: interest.id, senderType, senderId: userId, content, mediaKey: dto.mediaKey },
    });
    await this.prisma.spaceInterest.update({
      where: { id: interest.id },
      data: {
        lastMessageAt: message.createdAt,
        ...(senderType === SpaceChatSenderType.SPACE ? { spaceLastReadAt: message.createdAt } : { requesterLastReadAt: message.createdAt }),
      },
    });

    const recipientUserId =
      senderType === SpaceChatSenderType.SPACE
        ? interest.requesterType === 'BRAND'
          ? interest.brandProfile?.userId
          : interest.hostProfile?.userId
        : interest.spaceCommunityProfile.spaceProfile.userId;

    const senderName =
      senderType === SpaceChatSenderType.SPACE
        ? interest.spaceCommunityProfile.name
        : senderType === SpaceChatSenderType.BRAND
          ? (interest.brandProfile?.brandName ?? 'A brand')
          : (interest.hostProfile?.communityProfile?.name ?? interest.hostProfile?.displayName ?? 'A community');

    const preview = content.trim() ? content.slice(0, 80) : '📷 Sent a photo';
    if (recipientUserId && recipientUserId !== userId) {
      void this.notificationsService
        .create(recipientUserId, 'space_chat_message', senderName, preview, { spaceInterestId: interest.id })
        .catch(() => undefined);
    }

    const mediaUrl = dto.mediaKey ? await this.storageService.getPresignedDownloadUrl(dto.mediaKey) : null;
    return { ...message, mediaUrl, wasRedacted };
  }

  // Space partner accepts a pending request — opens the chat both sides ("Requests" → "Chats").
  async acceptSpaceInterest(userId: string, interestId: string) {
    const { interest, isSpace } = await this.getSpaceInterestForParticipant(userId, interestId);
    if (!isSpace) throw new ForbiddenException('Only the space can accept this request');
    if (interest.chatStatus === 'ACCEPTED') return { message: 'Already accepted', chatStatus: interest.chatStatus };

    const updated = await this.prisma.spaceInterest.update({
      where: { id: interestId },
      data: { chatStatus: 'ACCEPTED', chatAcceptedAt: new Date() },
    });

    const recipientUserId = interest.requesterType === 'BRAND' ? interest.brandProfile?.userId : interest.hostProfile?.userId;
    if (recipientUserId) {
      void this.notificationsService
        .create(
          recipientUserId,
          'space_interest_accepted',
          'Request accepted!',
          `${interest.spaceCommunityProfile.name} accepted your interest — you can now chat with them.`,
          { spaceInterestId: interestId },
        )
        .catch(() => undefined);
    }

    return { message: 'Request accepted', chatStatus: updated.chatStatus };
  }

  // Space partner declines a pending request — terminal state, no further chat.
  async declineSpaceInterest(userId: string, interestId: string) {
    const { interest, isSpace } = await this.getSpaceInterestForParticipant(userId, interestId);
    if (!isSpace) throw new ForbiddenException('Only the space can decline this request');
    if (interest.chatStatus !== 'REQUESTED') {
      throw new BadRequestException('Only a pending request can be declined');
    }

    const updated = await this.prisma.spaceInterest.update({ where: { id: interestId }, data: { chatStatus: 'DECLINED' } });
    return { message: 'Request declined', chatStatus: updated.chatStatus };
  }
}
