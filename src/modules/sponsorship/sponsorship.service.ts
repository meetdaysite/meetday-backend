import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Prisma, SponsorshipStatus, SponsorshipChatStatus, ChatSenderType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CreateProposalDto } from './dto/create-proposal.dto';
import { UpdateProposalDto } from './dto/update-proposal.dto';
import { ListProposalsQueryDto } from './dto/list-proposals-query.dto';
import { ListPublishedQueryDto } from './dto/list-published-query.dto';
import { ListSponsorshipChatsQueryDto } from './dto/list-sponsorship-chats-query.dto';
import { SendChatMessageDto } from './dto/send-chat-message.dto';
import { UpdateChatMessageDto } from './dto/update-chat-message.dto';
import { UpsertSponsorshipDealDto } from './dto/upsert-sponsorship-deal.dto';
import { RequestDealChangesDto } from './dto/request-deal-changes.dto';
import { ADMIN_ALERT_EMAILS } from '../../common/mail/admin-recipients.constant';
import { redactPersonalInfo } from '../../common/utils/redact-personal-info.util';

const ADMIN_ROLES = ['SUPER_ADMIN', 'CITY_ADMIN', 'MODERATOR'];

// Shape of one raw stored past-event entry (HostCommunityProfile.pastEvents JSON column).
type PastEventLike = { name?: string; description?: string; imageKeys?: string[] };

@Injectable()
export class SponsorshipService {
  private readonly logger = new Logger(SponsorshipService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly notificationsService: NotificationsService,
    private readonly auditLogService: AuditLogService,
    @InjectQueue('mail') private readonly mailQueue: Queue,
  ) {}

  private async withSignedUrls<
    T extends { imageKey: string; docKey: string; pendingRevision: Prisma.JsonValue | null },
  >(proposal: T) {
    const [imageUrl, docUrl] = await Promise.all([
      proposal.imageKey ? this.storageService.getPresignedDownloadUrl(proposal.imageKey) : null,
      proposal.docKey ? this.storageService.getPresignedDownloadUrl(proposal.docKey) : null,
    ]);

    let pendingRevision = proposal.pendingRevision as (Record<string, unknown> & { imageKey?: string; docKey?: string }) | null;
    if (pendingRevision) {
      // Only sign a URL for keys actually present in the diff — otherwise an unrelated field
      // edit (e.g. just the date) would overwrite the still-valid live image/doc URL with null.
      const [revImageUrl, revDocUrl] = await Promise.all([
        pendingRevision.imageKey ? this.storageService.getPresignedDownloadUrl(pendingRevision.imageKey as string) : undefined,
        pendingRevision.docKey ? this.storageService.getPresignedDownloadUrl(pendingRevision.docKey as string) : undefined,
      ]);
      pendingRevision = {
        ...pendingRevision,
        ...(revImageUrl !== undefined && { imageUrl: revImageUrl }),
        ...(revDocUrl !== undefined && { docUrl: revDocUrl }),
      };
    }

    return { ...proposal, imageUrl, docUrl, pendingRevision };
  }

  // Signs each past event's image keys into downloadable URLs — pastEvents is stored as raw
  // JSON (array of { name?, description?, imageKeys? }), entirely optional at every level.
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

  private async getOwnedProposal(userId: string, id: string) {
    const proposal = await this.prisma.sponsorshipProposal.findUnique({
      where: { id },
      include: { hostProfile: { select: { userId: true } } },
    });
    if (!proposal) throw new NotFoundException('Sponsorship proposal not found');
    if (proposal.hostProfile.userId !== userId)
      throw new ForbiddenException('You do not own this proposal');
    return proposal;
  }

  async createProposal(userId: string, dto: CreateProposalDto) {
    const hostProfile = await this.prisma.hostProfile.findUnique({
      where: { userId },
      select: { id: true, approvalStatus: true },
    });
    if (!hostProfile) throw new NotFoundException('Host profile not found');
    if (hostProfile.approvalStatus !== 'APPROVED')
      throw new ForbiddenException('Host must be approved to raise a sponsorship proposal');

    const proposal = await this.prisma.sponsorshipProposal.create({
      data: {
        hostProfileId: hostProfile.id,
        name: dto.name ?? '',
        about: dto.about ?? '',
        imageKey: dto.imageKey ?? '',
        eventDate: dto.eventDate ? new Date(dto.eventDate) : new Date(0),
        eventEndDate: dto.eventEndDate ? new Date(dto.eventEndDate) : null,
        // `venue`/`city` are deprecated (kept for the NOT NULL DB columns) — derived from the first entry.
        venue: dto.venues?.[0] ?? '',
        venues: dto.venues ?? [],
        city: dto.venueCities?.[0] ?? '',
        venueCities: dto.venueCities ?? [],
        audienceProfile: dto.audienceProfile ?? [],
        ageGroup: dto.ageGroup ?? '',
        guestCount: dto.guestCount ?? '',
        videoUrl: dto.videoUrl ?? null,
        docKey: dto.docKey ?? '',
        docName: dto.docName ?? '',
        docType: dto.docType ?? '',
        docSize: dto.docSize ?? 0,
        sponsorTiers: (dto.sponsorTiers ?? []) as unknown as Prisma.InputJsonValue,
        status: SponsorshipStatus.DRAFT,
      },
    });

    this.auditLogService.log({
      actorId: userId,
      actorRole: 'HOST',
      action: 'SPONSORSHIP_PROPOSAL_CREATED',
      entityType: 'SPONSORSHIP_PROPOSAL',
      entityId: proposal.id,
    });

    return this.withSignedUrls(proposal);
  }

  /**
   * DRAFT/REJECTED proposals are edited directly. UNDER_REVIEW/PUBLISHED proposals accept edits
   * as a `pendingRevision` snapshot instead — the live fields stay untouched until an admin
   * approves it, mirroring the Event revision flow but embedded on the same row.
   */
  async updateProposal(userId: string, id: string, dto: UpdateProposalDto) {
    const proposal = await this.getOwnedProposal(userId, id);

    const directlyEditable =
      proposal.status === SponsorshipStatus.DRAFT ||
      proposal.status === SponsorshipStatus.REJECTED ||
      proposal.status === SponsorshipStatus.UNDER_REVIEW;

    if (directlyEditable) {
      return this.withSignedUrls(
        await this.prisma.sponsorshipProposal.update({
          where: { id },
          data: {
            ...(dto.name !== undefined && { name: dto.name }),
            ...(dto.about !== undefined && { about: dto.about }),
            ...(dto.imageKey !== undefined && { imageKey: dto.imageKey }),
            ...(dto.eventDate !== undefined && { eventDate: new Date(dto.eventDate) }),
            ...(dto.eventEndDate !== undefined && {
              eventEndDate: dto.eventEndDate ? new Date(dto.eventEndDate) : null,
            }),
            ...(dto.venues !== undefined && {
              venues: dto.venues,
              venue: dto.venues[0] ?? '',
            }),
            ...(dto.venueCities !== undefined && {
              venueCities: dto.venueCities,
              city: dto.venueCities[0] ?? '',
            }),
            ...(dto.audienceProfile !== undefined && { audienceProfile: dto.audienceProfile }),
            ...(dto.ageGroup !== undefined && { ageGroup: dto.ageGroup }),
            ...(dto.guestCount !== undefined && { guestCount: dto.guestCount }),
            ...(dto.videoUrl !== undefined && { videoUrl: dto.videoUrl }),
            ...(dto.docKey !== undefined && { docKey: dto.docKey }),
            ...(dto.docName !== undefined && { docName: dto.docName }),
            ...(dto.docType !== undefined && { docType: dto.docType }),
            ...(dto.docSize !== undefined && { docSize: dto.docSize }),
            ...(dto.sponsorTiers !== undefined && {
              sponsorTiers: dto.sponsorTiers as unknown as Prisma.InputJsonValue,
            }),
          },
        }),
      );
    }

    // UNDER_REVIEW or PUBLISHED — stash as a pending revision awaiting admin approval.
    const changes = JSON.parse(JSON.stringify(dto)) as Record<string, unknown>;
    if (Object.keys(changes).length === 0) throw new BadRequestException('No changes provided');

    const updated = await this.prisma.sponsorshipProposal.update({
      where: { id },
      data: { pendingRevision: changes as unknown as Prisma.InputJsonValue },
    });

    this.auditLogService.log({
      actorId: userId,
      actorRole: 'HOST',
      action: 'SPONSORSHIP_PROPOSAL_REVISION_SUBMITTED',
      entityType: 'SPONSORSHIP_PROPOSAL',
      entityId: id,
    });

    const admins = await this.prisma.user.findMany({
      where: { isActive: true, role: { name: { in: ADMIN_ROLES } } },
      select: { id: true },
    });
    void Promise.allSettled(
      admins.map((admin) =>
        this.notificationsService.create(
          admin.id,
          'sponsorship_revision_pending',
          'Sponsorship proposal edit pending review',
          `Edits to "${proposal.name || 'Untitled proposal'}" are awaiting review.`,
          { proposalId: id },
        ),
      ),
    );

    return this.withSignedUrls(updated);
  }

  async getMyProposals(userId: string, query: ListProposalsQueryDto) {
    const hostProfile = await this.prisma.hostProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!hostProfile) throw new NotFoundException('Host profile not found');

    const proposals = await this.prisma.sponsorshipProposal.findMany({
      where: { hostProfileId: hostProfile.id, ...(query.status && { status: query.status }) },
      orderBy: { updatedAt: 'desc' },
    });

    const withSignedUrls = await Promise.all(proposals.map((p) => this.withSignedUrls(p)));
    return { proposals: withSignedUrls, total: withSignedUrls.length, page: 1, limit: withSignedUrls.length };
  }

  // Flattens a host's community profile categories onto the proposal for brand-side filtering.
  // Only an APPROVED community profile counts — pending/rejected ones are treated as uncategorized.
  private static readonly PUBLISHED_INCLUDE = {
    hostProfile: {
      select: {
        id: true,
        displayName: true,
        user: { select: { firstName: true, lastName: true } },
        communityProfile: {
          select: {
            approvalStatus: true,
            categories: { select: { category: { select: { id: true, name: true } } } },
          },
        },
      },
    },
  } as const;

  private flattenCategories<
    T extends {
      hostProfile: {
        communityProfile: {
          approvalStatus: string;
          categories: { category: { id: string; name: string } }[];
        } | null;
      };
    },
  >(proposal: T) {
    const { hostProfile, ...rest } = proposal;
    const { communityProfile, ...hostRest } = hostProfile;
    const categories =
      communityProfile?.approvalStatus === 'APPROVED'
        ? communityProfile.categories.map((c) => c.category)
        : [];
    return { ...rest, hostProfile: { ...hostRest, categories } };
  }

  // Brand-facing: every published proposal across all hosts, newest first. Optionally filtered by
  // category, matched against the host's APPROVED community profile categories.
  async getAllPublishedProposals(query: ListPublishedQueryDto) {
    const proposals = await this.prisma.sponsorshipProposal.findMany({
      where: {
        status: SponsorshipStatus.PUBLISHED,
        ...(query.categoryId && {
          hostProfile: {
            communityProfile: {
              approvalStatus: 'APPROVED',
              categories: { some: { categoryId: query.categoryId } },
            },
          },
        }),
      },
      include: SponsorshipService.PUBLISHED_INCLUDE,
      orderBy: { updatedAt: 'desc' },
    });

    const withSignedUrls = await Promise.all(
      proposals.map(async (p) => this.flattenCategories(await this.withSignedUrls(p))),
    );
    // Brands must never see a host's not-yet-approved pending edits.
    const withoutPendingRevision = withSignedUrls.map(({ pendingRevision: _pendingRevision, ...p }) => p);
    return { proposals: withoutPendingRevision, total: withoutPendingRevision.length };
  }

  // Brand-facing: full detail of one published proposal, including the host's community profile
  // (if approved) for the "data room" view.
  async getPublishedProposalDetail(id: string) {
    const proposal = await this.prisma.sponsorshipProposal.findUnique({
      where: { id },
      include: {
        hostProfile: {
          select: {
            id: true,
            displayName: true,
            operatingCities: true,
            socialLinks: true,
            user: { select: { firstName: true, lastName: true } },
            communityProfile: {
              include: { categories: { include: { category: true } } },
            },
          },
        },
      },
    });
    if (!proposal || proposal.status !== SponsorshipStatus.PUBLISHED)
      throw new NotFoundException('Sponsorship proposal not found');

    const withUrls = await this.withSignedUrls(proposal);
    const { hostProfile, ...rest } = withUrls;
    const { communityProfile, ...hostRest } = hostProfile;

    let community: Record<string, unknown> | null = null;
    if (communityProfile && communityProfile.approvalStatus === 'APPROVED') {
      const { categories, logoKey, secondaryImageKey, pastEvents, ...communityRest } = communityProfile;
      const [logoUrl, secondaryImageUrl, pastEventsWithUrls] = await Promise.all([
        logoKey ? this.storageService.getPresignedDownloadUrl(logoKey) : null,
        secondaryImageKey ? this.storageService.getPresignedDownloadUrl(secondaryImageKey) : null,
        this.withPastEventImageUrls(pastEvents as PastEventLike[] | null),
      ]);
      community = {
        ...communityRest,
        logoUrl,
        secondaryImageUrl,
        pastEvents: pastEventsWithUrls,
        categories: categories.map((c) => c.category),
      };
    }

    // Brands must never see the host's not-yet-approved pending edits.
    const { pendingRevision: _pendingRevision, ...restWithoutPendingRevision } = rest;
    return { ...restWithoutPendingRevision, hostProfile: hostRest, community };
  }

  // Brand marks interest in a published proposal — notifies admins (full brand details) and the
  // hosting community (anonymized — the brand's identity is never revealed to the host).
  // Requires a complete brand profile (name + categories + at least one social link).
  // Idempotent: calling again for the same brand+proposal is a no-op (no duplicate notifications).
  async markInterest(userId: string, proposalId: string) {
    const brandProfile = await this.prisma.brandProfile.findUnique({
      where: { userId },
      select: {
        id: true,
        brandName: true,
        socialLinks: true,
        approvalStatus: true,
        user: { select: { email: true } },
        categories: { select: { category: { select: { name: true } } } },
      },
    });
    if (!brandProfile) throw new NotFoundException('Brand profile not found');

    if (brandProfile.approvalStatus !== 'APPROVED') {
      throw new BadRequestException('Your profile must be approved by an admin before you can express interest.');
    }

    const socialLinks = (brandProfile.socialLinks ?? {}) as Record<string, string | undefined>;
    const categoryNames = brandProfile.categories.map((c) => c.category.name);
    const hasSocialLink = Object.values(socialLinks).some((v) => !!v);
    if (!brandProfile.brandName || categoryNames.length === 0 || !hasSocialLink) {
      throw new BadRequestException(
        'Please complete your brand profile (name, categories, and social links) before expressing interest.',
      );
    }

    const proposal = await this.prisma.sponsorshipProposal.findUnique({
      where: { id: proposalId },
      include: {
        hostProfile: {
          include: {
            user: { select: { id: true } },
            communityProfile: { select: { name: true } },
          },
        },
      },
    });
    if (!proposal || proposal.status !== SponsorshipStatus.PUBLISHED)
      throw new NotFoundException('Sponsorship proposal not found');

    const existing = await this.prisma.sponsorshipInterest.findUnique({
      where: { sponsorshipProposalId_brandProfileId: { sponsorshipProposalId: proposalId, brandProfileId: brandProfile.id } },
    });
    if (existing) return { message: 'Already marked as interested', alreadyInterested: true };

    await this.prisma.sponsorshipInterest.create({
      data: { sponsorshipProposalId: proposalId, brandProfileId: brandProfile.id },
    });

    // Host/community notification now reveals the brand's name — TriChat needs the host to know
    // who is interested so they can decide whether to accept and start chatting.
    void this.notificationsService
      .create(
        proposal.hostProfile.user.id,
        'brand_interested_in_sponsorship',
        `${brandProfile.brandName} is interested!`,
        'This brand is interested in your proposal. Check your Chats to respond.',
        { proposalId },
      )
      .catch((err) => this.logger.error('Failed to notify host of brand interest', err));

    // Confirms back to the brand itself that the community has been notified — persisted so it
    // shows up in their Notifications page, not just an ephemeral success toast.
    void this.notificationsService
      .create(
        userId,
        'brand_interest_confirmed',
        'Interest sent!',
        'The community is notified of your interest.',
        { proposalId },
      )
      .catch((err) => this.logger.error('Failed to notify brand of confirmed interest', err));

    const communityName = proposal.hostProfile.communityProfile?.name ?? proposal.hostProfile.displayName ?? 'Unknown community';
    for (const to of ADMIN_ALERT_EMAILS) {
      void this.mailQueue
        .add('brand-interest', {
          to,
          communityName,
          proposalName: proposal.name || 'Untitled proposal',
          brandName: brandProfile.brandName,
          brandEmail: brandProfile.user.email,
          categories: categoryNames,
          socialLinks,
        })
        .catch((err) => this.logger.error('Failed to enqueue brand-interest mail job', err));
    }

    return { message: 'Interest recorded', alreadyInterested: false };
  }

  // Brand-facing: every admin-approved community profile, newest first — basic info only
  // (logo, name, size, categories) for the brand "Communities" browse page.
  async listApprovedCommunities() {
    const profiles = await this.prisma.hostCommunityProfile.findMany({
      where: { approvalStatus: 'APPROVED' },
      select: {
        id: true,
        hostProfileId: true,
        name: true,
        about: true,
        logoKey: true,
        secondaryImageKey: true,
        size: true,
        avgGuestCount: true,
        experiencesPerYear: true,
        categories: { select: { category: { select: { id: true, name: true } } } },
        hostProfile: {
          select: {
            operatingCities: true,
            socialLinks: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const communities = await Promise.all(
      profiles.map(async ({ logoKey, secondaryImageKey, categories, hostProfile, ...rest }) => ({
        ...rest,
        logoUrl: logoKey ? await this.storageService.getPresignedDownloadUrl(logoKey) : null,
        secondaryImageUrl: secondaryImageKey ? await this.storageService.getPresignedDownloadUrl(secondaryImageKey) : null,
        categories: categories.map((c) => c.category),
        operatingCities: hostProfile?.operatingCities ?? [],
        socialLinks: hostProfile?.socialLinks ?? null,
      })),
    );

    return { communities, total: communities.length };
  }

  async getProposalDetail(userId: string, id: string) {
    const proposal = await this.getOwnedProposal(userId, id);
    return this.withSignedUrls(proposal);
  }

  async submitProposal(userId: string, id: string) {
    const proposal = await this.getOwnedProposal(userId, id);
    if (proposal.status !== SponsorshipStatus.DRAFT && proposal.status !== SponsorshipStatus.REJECTED)
      throw new ForbiddenException('Only DRAFT or REJECTED proposals can be submitted for review');

    const hostProfile = await this.prisma.hostProfile.findUnique({
      where: { userId },
      select: { communityProfile: { select: { approvalStatus: true } } },
    });
    if (hostProfile?.communityProfile?.approvalStatus !== 'APPROVED') {
      throw new BadRequestException(
        'Your community profile must be activated and approved by an admin before you can submit a sponsorship proposal for review.',
      );
    }

    const missing: string[] = [];
    if (!proposal.name) missing.push('name');
    if (!proposal.about) missing.push('about');
    if (!proposal.imageKey) missing.push('imageKey');
    if (!proposal.eventDate || proposal.eventDate.getTime() === 0) missing.push('eventDate');
    if (!proposal.venue) missing.push('venue');
    if (!proposal.city) missing.push('city');
    if (!(proposal.audienceProfile as string[])?.length) missing.push('audienceProfile');
    if (!proposal.ageGroup) missing.push('ageGroup');
    if (!proposal.guestCount) missing.push('guestCount');
    if (!proposal.docKey) missing.push('docKey');
    if (!(proposal.sponsorTiers as unknown[])?.length) missing.push('sponsorTiers');

    if (missing.length) throw new BadRequestException(`Proposal is incomplete. Missing: ${missing.join(', ')}`);

    const updated = await this.prisma.sponsorshipProposal.update({
      where: { id },
      data: {
        status: SponsorshipStatus.UNDER_REVIEW,
        submittedAt: new Date(),
        adminRejectionRemark: null,
      },
    });

    this.auditLogService.log({
      actorId: userId,
      actorRole: 'HOST',
      action: 'SPONSORSHIP_PROPOSAL_SUBMITTED',
      entityType: 'SPONSORSHIP_PROPOSAL',
      entityId: id,
    });

    const admins = await this.prisma.user.findMany({
      where: { isActive: true, role: { name: { in: ADMIN_ROLES } } },
      select: { id: true, email: true },
    });
    const notifyResults = await Promise.allSettled(
      admins.map((admin) =>
        this.notificationsService.create(
          admin.id,
          'sponsorship_pending_review',
          'New sponsorship proposal pending review',
          `"${proposal.name}" has been submitted for review.`,
          { proposalId: id },
        ),
      ),
    );
    notifyResults.forEach((r, i) => {
      if (r.status === 'rejected')
        this.logger.error(`Failed to notify admin ${admins[i].id} of pending sponsorship proposal`, r.reason);
    });

    const submitter = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true },
    });
    for (const to of ADMIN_ALERT_EMAILS) {
      void this.mailQueue
        .add('sponsorship-submitted', { to, hostName: submitter?.firstName, proposalName: proposal.name })
        .catch((err) => this.logger.error('Failed to enqueue sponsorship-submitted mail job', err));
    }

    return this.withSignedUrls(updated);
  }

  async deleteProposal(userId: string, id: string) {
    const proposal = await this.getOwnedProposal(userId, id);
    await this.prisma.sponsorshipProposal.delete({ where: { id } });

    this.auditLogService.log({
      actorId: userId,
      actorRole: 'HOST',
      action: 'SPONSORSHIP_PROPOSAL_DELETED',
      entityType: 'SPONSORSHIP_PROPOSAL',
      entityId: id,
    });
    return { message: 'Proposal deleted successfully', deleted: true };
  }

  // ── TriChat: Host ↔ Brand chat tied to a SponsorshipInterest ────────────
  // "Requests" (chatStatus=REQUESTED) vs "General"/"Accepted" (chatStatus=ACCEPTED) is purely
  // this status field — the frontend segments the same list by it, no separate query needed.

  private async getOwnProfiles(userId: string) {
    const [hostProfile, brandProfile] = await Promise.all([
      this.prisma.hostProfile.findUnique({ where: { userId }, select: { id: true } }),
      this.prisma.brandProfile.findUnique({ where: { userId }, select: { id: true } }),
    ]);
    return { hostProfile, brandProfile };
  }

  async listMyChats(userId: string, query: ListSponsorshipChatsQueryDto) {
    const { hostProfile, brandProfile } = await this.getOwnProfiles(userId);
    if (!hostProfile && !brandProfile) throw new NotFoundException('No host or brand profile found for this account');

    const where: Prisma.SponsorshipInterestWhereInput = {
      ...(query.status && { chatStatus: query.status }),
      ...(hostProfile ? { sponsorshipProposal: { hostProfileId: hostProfile.id } } : { brandProfileId: brandProfile!.id }),
    };

    const interests = await this.prisma.sponsorshipInterest.findMany({
      where,
      include: {
        sponsorshipProposal: {
          select: {
            id: true,
            name: true,
            hostProfile: { select: { displayName: true, communityProfile: { select: { name: true, logoKey: true } } } },
          },
        },
        brandProfile: { select: { id: true, brandName: true, logoKey: true } },
        chatMessages: { orderBy: { createdAt: 'desc' }, take: 1, select: { content: true, mediaKey: true, senderType: true, createdAt: true } },
      },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
    });

    // Unread = messages from the other side sent after I last opened this thread.
    const unreadCounts = await Promise.all(
      interests.map((i) => {
        const lastReadAt = hostProfile ? i.hostLastReadAt : i.brandLastReadAt;
        const otherSenderType = hostProfile ? ChatSenderType.BRAND : ChatSenderType.HOST;
        return this.prisma.sponsorshipChatMessage.count({
          where: {
            sponsorshipInterestId: i.id,
            senderType: otherSenderType,
            ...(lastReadAt && { createdAt: { gt: lastReadAt } }),
          },
        });
      }),
    );

    return Promise.all(
      interests.map(async (i, idx) => {
        const counterpartLogoKey = hostProfile ? i.brandProfile.logoKey : i.sponsorshipProposal.hostProfile.communityProfile?.logoKey;
        return {
          id: i.id,
          proposalId: i.sponsorshipProposal.id,
          proposalName: i.sponsorshipProposal.name,
          chatStatus: i.chatStatus,
          createdAt: i.createdAt,
          chatAcceptedAt: i.chatAcceptedAt,
          lastMessageAt: i.lastMessageAt,
          lastMessagePreview: i.chatMessages[0] ? (i.chatMessages[0].content || (i.chatMessages[0].mediaKey ? '📷 Photo' : '')).slice(0, 120) : null,
          unreadCount: unreadCounts[idx],
          // From the host's side, the counterpart is the brand; from the brand's side, it's the community.
          counterpartName: hostProfile
            ? i.brandProfile.brandName
            : i.sponsorshipProposal.hostProfile.communityProfile?.name ?? i.sponsorshipProposal.hostProfile.displayName ?? 'Community',
          counterpartAvatarUrl: counterpartLogoKey ? await this.storageService.getPresignedDownloadUrl(counterpartLogoKey) : null,
        };
      }),
    );
  }

  // Verifies the caller is either the host or the brand on this interest and returns which "hat"
  // they're wearing, for use as senderType when they post a message.
  private async getInterestForParticipant(userId: string, interestId: string) {
    const interest = await this.prisma.sponsorshipInterest.findUnique({
      where: { id: interestId },
      include: {
        sponsorshipProposal: {
          select: {
            id: true,
            name: true,
            hostProfile: { select: { id: true, userId: true, displayName: true, communityProfile: { select: { name: true } } } },
          },
        },
        brandProfile: { select: { id: true, userId: true, brandName: true } },
      },
    });
    if (!interest) throw new NotFoundException('Chat thread not found');

    const isHost = interest.sponsorshipProposal.hostProfile.userId === userId;
    const isBrand = interest.brandProfile.userId === userId;
    if (!isHost && !isBrand) throw new ForbiddenException('You do not have access to this chat');

    return { interest, senderType: isHost ? ChatSenderType.HOST : ChatSenderType.BRAND };
  }

  async listChatMessages(userId: string, interestId: string) {
    const { interest, senderType } = await this.getInterestForParticipant(userId, interestId);

    // Captured before this call marks the thread read below, so both the unread-divider and the
    // seen-tick reflect state as of the moment the thread was opened, not after.
    const myPreviousLastReadAt = senderType === ChatSenderType.HOST ? interest.hostLastReadAt : interest.brandLastReadAt;
    const otherLastReadAt = senderType === ChatSenderType.HOST ? interest.brandLastReadAt : interest.hostLastReadAt;

    const messages = await this.prisma.sponsorshipChatMessage.findMany({
      where: { sponsorshipInterestId: interest.id },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: {
        id: true,
        senderType: true,
        senderId: true,
        messageType: true,
        content: true,
        mediaKey: true,
        editedAt: true,
        deletedAt: true,
        createdAt: true,
      },
    });

    let firstUnreadMessageId: string | null = null;
    let unreadCount = 0;
    for (const m of messages) {
      if (m.senderType !== senderType && (!myPreviousLastReadAt || m.createdAt > myPreviousLastReadAt)) {
        if (!firstUnreadMessageId) firstUnreadMessageId = m.id;
        unreadCount += 1;
      }
    }

    const withMediaUrls = await Promise.all(
      messages.map(async ({ mediaKey, deletedAt, ...m }) => {
        // Deleted messages are hidden from host/brand (placeholder only) — admin still sees the
        // original content via the separate admin endpoint, which doesn't go through this path.
        if (deletedAt) {
          return { ...m, content: '', mediaUrl: null, deletedAt, seenByOther: false };
        }
        return {
          ...m,
          deletedAt: null,
          mediaUrl: mediaKey ? await this.storageService.getPresignedDownloadUrl(mediaKey) : null,
          seenByOther: m.senderType === senderType && !!otherLastReadAt && m.createdAt <= otherLastReadAt,
        };
      }),
    );

    // Opening the thread marks everything up to now as read for this side.
    void this.prisma.sponsorshipInterest
      .update({
        where: { id: interest.id },
        data: senderType === ChatSenderType.HOST ? { hostLastReadAt: new Date() } : { brandLastReadAt: new Date() },
      })
      .catch((err) => this.logger.error('Failed to update chat read state', err));

    return { messages: withMediaUrls, chatStatus: interest.chatStatus, unreadCount, firstUnreadMessageId };
  }

  async editChatMessage(userId: string, interestId: string, messageId: string, dto: UpdateChatMessageDto) {
    const { interest } = await this.getInterestForParticipant(userId, interestId);
    const message = await this.prisma.sponsorshipChatMessage.findUnique({ where: { id: messageId } });
    if (!message || message.sponsorshipInterestId !== interest.id) throw new NotFoundException('Message not found');
    if (message.senderId !== userId) throw new ForbiddenException('You can only edit your own messages');
    if (message.deletedAt) throw new BadRequestException('Cannot edit a deleted message');

    const { content, wasRedacted } = redactPersonalInfo(dto.content);
    const updated = await this.prisma.sponsorshipChatMessage.update({
      where: { id: messageId },
      data: { content, editedAt: new Date() },
    });

    const mediaUrl = updated.mediaKey ? await this.storageService.getPresignedDownloadUrl(updated.mediaKey) : null;
    return { ...updated, mediaUrl, wasRedacted };
  }

  // Soft delete — content stays in the DB for admin's view, host/brand just see a placeholder.
  async deleteChatMessage(userId: string, interestId: string, messageId: string) {
    const { interest } = await this.getInterestForParticipant(userId, interestId);
    const message = await this.prisma.sponsorshipChatMessage.findUnique({ where: { id: messageId } });
    if (!message || message.sponsorshipInterestId !== interest.id) throw new NotFoundException('Message not found');
    if (message.senderId !== userId) throw new ForbiddenException('You can only delete your own messages');
    if (message.deletedAt) return { message: 'Already deleted', deleted: true };

    await this.prisma.sponsorshipChatMessage.update({ where: { id: messageId }, data: { deletedAt: new Date() } });
    return { message: 'Message deleted', deleted: true };
  }

  async sendChatMessage(userId: string, interestId: string, dto: SendChatMessageDto) {
    const { interest, senderType } = await this.getInterestForParticipant(userId, interestId);
    if (interest.chatStatus !== SponsorshipChatStatus.ACCEPTED) {
      throw new BadRequestException('The community must accept this request before you can chat.');
    }
    if (!dto.content?.trim() && !dto.mediaKey) {
      throw new BadRequestException('Message must have text or an image');
    }

    // Contact info must stay off-platform-conversation — redact emails/phone numbers so hosts
    // and brands can't route around Meetday, and tell the sender why in the response.
    const { content, wasRedacted } = dto.content ? redactPersonalInfo(dto.content) : { content: '', wasRedacted: false };

    const message = await this.prisma.sponsorshipChatMessage.create({
      data: { sponsorshipInterestId: interest.id, senderType, senderId: userId, content, mediaKey: dto.mediaKey },
    });
    await this.prisma.sponsorshipInterest.update({
      where: { id: interest.id },
      data: {
        lastMessageAt: message.createdAt,
        // Sending also counts as having read up to now, on my own side.
        ...(senderType === ChatSenderType.HOST ? { hostLastReadAt: message.createdAt } : { brandLastReadAt: message.createdAt }),
      },
    });

    const recipientUserId =
      senderType === ChatSenderType.HOST ? interest.brandProfile.userId : interest.sponsorshipProposal.hostProfile.userId;
    const senderName =
      senderType === ChatSenderType.HOST
        ? interest.sponsorshipProposal.hostProfile.communityProfile?.name ?? interest.sponsorshipProposal.hostProfile.displayName ?? 'The community'
        : interest.brandProfile.brandName;
    const preview = content.trim() ? content.slice(0, 80) : '📷 Sent a photo';
    void this.notificationsService
      .create(recipientUserId, 'sponsorship_chat_message', senderName, preview, {
        sponsorshipInterestId: interest.id,
      })
      .catch((err) => this.logger.error('Failed to notify of new chat message', err));

    const mediaUrl = dto.mediaKey ? await this.storageService.getPresignedDownloadUrl(dto.mediaKey) : null;
    return { ...message, mediaUrl, wasRedacted };
  }


  // Host accepts a brand's interest — opens the chat window both sides ("Requests" → "General").
  async acceptChatRequest(userId: string, interestId: string) {
    const interest = await this.prisma.sponsorshipInterest.findUnique({
      where: { id: interestId },
      include: {
        sponsorshipProposal: { select: { hostProfile: { select: { userId: true } } } },
        brandProfile: { select: { userId: true, brandName: true } },
      },
    });
    if (!interest) throw new NotFoundException('Chat thread not found');
    if (interest.sponsorshipProposal.hostProfile.userId !== userId) {
      throw new ForbiddenException('Only the host can accept this request');
    }
    if (interest.chatStatus === SponsorshipChatStatus.ACCEPTED) {
      return { message: 'Already accepted', chatStatus: interest.chatStatus };
    }

    const updated = await this.prisma.sponsorshipInterest.update({
      where: { id: interestId },
      data: { chatStatus: SponsorshipChatStatus.ACCEPTED, chatAcceptedAt: new Date() },
    });

    void this.notificationsService
      .create(
        interest.brandProfile.userId,
        'sponsorship_chat_accepted',
        'Request accepted!',
        'The community accepted your interest — you can now chat with them.',
        { sponsorshipInterestId: interestId },
      )
      .catch((err) => this.logger.error('Failed to notify brand of accepted chat request', err));

    return { message: 'Request accepted', chatStatus: updated.chatStatus };
  }

  // ── Deal Lock: negotiated final terms, filled in by the host, approved by the brand ─────
  // Nothing in the original proposal is final — chat negotiation can change anything; once both
  // sides agree, the host locks it into a structured deal that the brand reviews and approves.

  async getDeal(userId: string, interestId: string) {
    const { interest } = await this.getInterestForParticipant(userId, interestId);
    return this.prisma.sponsorshipDeal.findUnique({ where: { sponsorshipInterestId: interest.id } });
  }

  private async postDealSystemMessage(interestId: string, senderType: ChatSenderType, senderId: string, content: string) {
    const message = await this.prisma.sponsorshipChatMessage.create({
      data: { sponsorshipInterestId: interestId, senderType, senderId, content, messageType: 'SYSTEM' },
    });
    await this.prisma.sponsorshipInterest.update({ where: { id: interestId }, data: { lastMessageAt: message.createdAt } });
    return message;
  }

  private hostNameOf(interest: { sponsorshipProposal: { hostProfile: { displayName: string | null; communityProfile: { name: string } | null } } }) {
    return interest.sponsorshipProposal.hostProfile.communityProfile?.name ?? interest.sponsorshipProposal.hostProfile.displayName ?? 'The community';
  }

  async createDeal(userId: string, interestId: string, dto: UpsertSponsorshipDealDto) {
    const { interest, senderType } = await this.getInterestForParticipant(userId, interestId);
    if (senderType !== ChatSenderType.HOST) throw new ForbiddenException('Only the community can lock a deal');
    if (interest.chatStatus !== SponsorshipChatStatus.ACCEPTED) {
      throw new BadRequestException('The chat must be accepted before locking a deal');
    }

    const existing = await this.prisma.sponsorshipDeal.findUnique({ where: { sponsorshipInterestId: interest.id } });
    if (existing) throw new BadRequestException('A deal already exists for this chat — use edit instead');

    const deal = await this.prisma.sponsorshipDeal.create({
      data: {
        sponsorshipInterestId: interest.id,
        eventName: dto.eventName,
        eventDate: new Date(dto.eventDate),
        eventTime: dto.eventTime,
        venue: dto.venue,
        finalAmount: dto.finalAmount,
        deliverables: dto.deliverables,
        otherTerms: dto.otherTerms,
        additionalNotes: dto.additionalNotes,
        createdById: userId,
      },
    });

    const hostName = this.hostNameOf(interest);
    await this.postDealSystemMessage(interest.id, ChatSenderType.HOST, userId, `📝 ${hostName} shared a deal proposal for your approval.`);

    void this.notificationsService
      .create(interest.brandProfile.userId, 'sponsorship_deal_submitted', hostName, `Shared a deal proposal: ${dto.eventName}`, {
        sponsorshipInterestId: interest.id,
      })
      .catch((err) => this.logger.error('Failed to notify brand of new deal proposal', err));

    return deal;
  }

  async updateDeal(userId: string, interestId: string, dto: UpsertSponsorshipDealDto) {
    const { interest, senderType } = await this.getInterestForParticipant(userId, interestId);
    if (senderType !== ChatSenderType.HOST) throw new ForbiddenException('Only the community can edit the deal');

    const existing = await this.prisma.sponsorshipDeal.findUnique({ where: { sponsorshipInterestId: interest.id } });
    if (!existing) throw new NotFoundException('No deal found for this chat — lock a deal first');
    if (existing.status === 'APPROVED') throw new BadRequestException('This deal is already locked and cannot be edited');

    const deal = await this.prisma.sponsorshipDeal.update({
      where: { id: existing.id },
      data: {
        eventName: dto.eventName,
        eventDate: new Date(dto.eventDate),
        eventTime: dto.eventTime,
        venue: dto.venue,
        finalAmount: dto.finalAmount,
        deliverables: dto.deliverables,
        otherTerms: dto.otherTerms,
        additionalNotes: dto.additionalNotes,
        status: 'PENDING_APPROVAL',
        changeRequestNote: null,
        version: { increment: 1 },
      },
    });

    const hostName = this.hostNameOf(interest);
    await this.postDealSystemMessage(interest.id, ChatSenderType.HOST, userId, `✏️ ${hostName} updated the deal proposal.`);

    void this.notificationsService
      .create(interest.brandProfile.userId, 'sponsorship_deal_updated', hostName, `Updated the deal proposal: ${dto.eventName}`, {
        sponsorshipInterestId: interest.id,
      })
      .catch((err) => this.logger.error('Failed to notify brand of updated deal proposal', err));

    return deal;
  }

  async approveDeal(userId: string, interestId: string) {
    const { interest, senderType } = await this.getInterestForParticipant(userId, interestId);
    if (senderType !== ChatSenderType.BRAND) throw new ForbiddenException('Only the brand can approve the deal');

    const existing = await this.prisma.sponsorshipDeal.findUnique({ where: { sponsorshipInterestId: interest.id } });
    if (!existing) throw new NotFoundException('No deal found for this chat');
    if (existing.status === 'APPROVED') return existing;

    const deal = await this.prisma.sponsorshipDeal.update({
      where: { id: existing.id },
      data: { status: 'APPROVED', approvedAt: new Date() },
    });

    await this.postDealSystemMessage(interest.id, ChatSenderType.BRAND, userId, '🎉 Congratulations! The deal is locked.');

    void this.notificationsService
      .create(
        interest.sponsorshipProposal.hostProfile.userId,
        'sponsorship_deal_locked',
        interest.brandProfile.brandName,
        `🎉 Approved and locked the deal: ${existing.eventName}`,
        { sponsorshipInterestId: interest.id },
      )
      .catch((err) => this.logger.error('Failed to notify host of locked deal', err));

    return deal;
  }

  async requestDealChanges(userId: string, interestId: string, dto: RequestDealChangesDto) {
    const { interest, senderType } = await this.getInterestForParticipant(userId, interestId);
    if (senderType !== ChatSenderType.BRAND) throw new ForbiddenException('Only the brand can request changes');

    const existing = await this.prisma.sponsorshipDeal.findUnique({ where: { sponsorshipInterestId: interest.id } });
    if (!existing) throw new NotFoundException('No deal found for this chat');
    if (existing.status === 'APPROVED') throw new BadRequestException('This deal is already locked');

    const deal = await this.prisma.sponsorshipDeal.update({
      where: { id: existing.id },
      data: { status: 'CHANGES_REQUESTED', changeRequestNote: dto.note ?? null },
    });

    const noteSuffix = dto.note?.trim() ? `: "${dto.note.trim()}"` : '.';
    await this.postDealSystemMessage(
      interest.id,
      ChatSenderType.BRAND,
      userId,
      `🔁 ${interest.brandProfile.brandName} requested changes to the deal${noteSuffix}`,
    );

    void this.notificationsService
      .create(
        interest.sponsorshipProposal.hostProfile.userId,
        'sponsorship_deal_changes_requested',
        interest.brandProfile.brandName,
        dto.note?.trim() ? `Requested changes: ${dto.note.trim()}` : 'Requested changes to the deal',
        { sponsorshipInterestId: interest.id },
      )
      .catch((err) => this.logger.error('Failed to notify host of requested deal changes', err));

    return deal;
  }
}
