import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
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
import { UpsertSponsorshipDealReportDto } from './dto/upsert-sponsorship-deal-report.dto';
import { VerifySponsorshipDealPaymentDto } from './dto/verify-sponsorship-deal-payment.dto';
import { ADMIN_ALERT_EMAILS } from '../../common/mail/admin-recipients.constant';
import { redactPersonalInfo } from '../../common/utils/redact-personal-info.util';
import { computeDealPaymentBreakdown as computeDealPaymentBreakdownUtil, DEFAULT_SPONSORSHIP_GST_RATE } from '../../common/utils/sponsorship-deal-payment.util';
import { TeamAccessService } from '../../common/team-access/team-access.service';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Razorpay = require('razorpay');

const ADMIN_ROLES = ['SUPER_ADMIN', 'CITY_ADMIN', 'MODERATOR'];

const DEAL_PAYMENT_DUE_DAYS = 3;

// Shape of one raw stored past-event entry (HostCommunityProfile.pastEvents JSON column).
type PastEventLike = { name?: string; description?: string; imageKeys?: string[] };
type BrandWorkedWithLike = { brandName?: string; logoKey?: string; url?: string };

@Injectable()
export class SponsorshipService {
  private readonly logger = new Logger(SponsorshipService.name);
  private readonly razorpay: any;
  private readonly razorpayKeyId: string;
  private readonly razorpayKeySecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly notificationsService: NotificationsService,
    private readonly auditLogService: AuditLogService,
    private readonly configService: ConfigService,
    @InjectQueue('mail') private readonly mailQueue: Queue,
    private readonly teamAccessService: TeamAccessService,
  ) {
    this.razorpayKeyId = this.configService.get<string>('razorpay.keyId');
    this.razorpayKeySecret = this.configService.get<string>('razorpay.keySecret');
    this.razorpay = new Razorpay({ key_id: this.razorpayKeyId, key_secret: this.razorpayKeySecret });
  }

  // Schedules the fallback "you have unread messages" email check — deduped by jobId so several
  // messages to the same recipient within the grace period collapse into a single check/email.
  private scheduleUnreadChatEmail(interestId: string, recipientUserId: string) {
    const delayMinutes = this.configService.get<number>('unreadChatEmailDelayMinutes') ?? 10;
    void this.mailQueue
      .add(
        'unread-chat-message-check',
        { interestId, recipientUserId },
        {
          delay: delayMinutes * 60_000,
          jobId: `unread-chat:${interestId}:${recipientUserId}`,
          removeOnComplete: true,
          removeOnFail: true,
        },
      )
      .catch((err) => this.logger.error('Failed to schedule unread-chat-message-check job', err));
  }

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

  // Signs each brand-worked-with entry's logo key into a downloadable URL — stored as raw JSON
  // (array of { brandName?, logoKey?, url? }), entirely optional at every level, no maximum count.
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

  private async getOwnedProposal(userId: string, id: string) {
    const proposal = await this.prisma.sponsorshipProposal.findUnique({
      where: { id },
      include: { hostProfile: { select: { userId: true } } },
    });
    if (!proposal) throw new NotFoundException('Sponsorship proposal not found');
    if (proposal.hostProfile.userId !== userId) {
      const hostProfileIds = await this.teamAccessService.getHostProfileIds(userId);
      if (!hostProfileIds.includes(proposal.hostProfileId))
        throw new ForbiddenException('You do not own this proposal');
    }
    return proposal;
  }

  async createProposal(userId: string, dto: CreateProposalDto) {
    const hostProfileId = await this.teamAccessService.resolveHostProfileId(userId);
    const hostProfile = await this.prisma.hostProfile.findUnique({
      where: { id: hostProfileId },
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
        sponsorshipType: dto.sponsorshipType || 'CASH',
        sponsorTiers: (dto.sponsorshipType === 'BARTER' ? [] : (dto.sponsorTiers ?? [])) as unknown as Prisma.InputJsonValue,
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
            ...(dto.sponsorshipType !== undefined && { sponsorshipType: dto.sponsorshipType }),
            ...(dto.sponsorTiers !== undefined && {
              sponsorTiers: (dto.sponsorshipType === 'BARTER' ? [] : dto.sponsorTiers) as unknown as Prisma.InputJsonValue,
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
    const id = await this.teamAccessService.resolveHostProfileId(userId);
    const hostProfile = await this.prisma.hostProfile.findUnique({ where: { id }, select: { id: true } });
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
        // A community an admin has hidden must not surface in brand browse/discovery at all.
        NOT: { hostProfile: { communityProfile: { isHidden: true } } },
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
  async getPublishedProposalDetail(id: string, userId?: string) {
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
    // A hidden community's proposals are treated as not found for brands, same as unpublished.
    if (proposal.hostProfile.communityProfile?.isHidden) throw new NotFoundException('Sponsorship proposal not found');

    const withUrls = await this.withSignedUrls(proposal);
    const { hostProfile, ...rest } = withUrls;
    const { communityProfile, ...hostRest } = hostProfile;

    let community: Record<string, unknown> | null = null;
    if (communityProfile && communityProfile.approvalStatus === 'APPROVED') {
      const { categories, logoKey, secondaryImageKey, pastEvents, brandsWorkedWith, ...communityRest } = communityProfile;
      const [logoUrl, secondaryImageUrl, pastEventsWithUrls, brandsWorkedWithWithUrls] = await Promise.all([
        logoKey ? this.storageService.getPresignedDownloadUrl(logoKey) : null,
        secondaryImageKey ? this.storageService.getPresignedDownloadUrl(secondaryImageKey) : null,
        this.withPastEventImageUrls(pastEvents as PastEventLike[] | null),
        this.withBrandsWorkedWithLogoUrls(brandsWorkedWith as BrandWorkedWithLike[] | null),
      ]);
      community = {
        ...communityRest,
        logoUrl,
        secondaryImageUrl,
        pastEvents: pastEventsWithUrls,
        brandsWorkedWith: brandsWorkedWithWithUrls,
        categories: categories.map((c) => c.category),
      };
    }

    // Brands must never see the host's not-yet-approved pending edits.
    const { pendingRevision: _pendingRevision, ...restWithoutPendingRevision } = rest;

    let alreadyInterested = false;
    if (userId) {
      const brandProfileIds = await this.teamAccessService.getBrandProfileIds(userId);
      const brand = brandProfileIds[0] ? { id: brandProfileIds[0] } : null;
      if (brand) {
        const interest = await this.prisma.sponsorshipInterest.findUnique({
          where: {
            sponsorshipProposalId_brandProfileId: {
              sponsorshipProposalId: id,
              brandProfileId: brand.id,
            },
          },
        });
        if (interest) {
          alreadyInterested = true;
        }
      }
    }

    return { ...restWithoutPendingRevision, hostProfile: hostRest, community, alreadyInterested };
  }

  // Brand marks interest in a published proposal — notifies admins (full brand details) and the
  // hosting community (anonymized — the brand's identity is never revealed to the host).
  // Requires a complete brand profile (name + categories + at least one social link).
  // Idempotent: calling again for the same brand+proposal is a no-op (no duplicate notifications).
  async markInterest(userId: string, proposalId: string) {
    const brandProfileId = await this.teamAccessService.resolveBrandProfileId(userId);
    const brandProfile = await this.prisma.brandProfile.findUnique({
      where: { id: brandProfileId },
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

    const interest = await this.prisma.sponsorshipInterest.create({
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
        { proposalId, sponsorshipInterestId: interest.id },
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
      where: { approvalStatus: 'APPROVED', isHidden: false },
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
        pastEvents: true,
        brandsWorkedWith: true,
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

    const signPastEvents = async (pastEvents) => {
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
    };

    const communities = await Promise.all(
      profiles.map(async ({ logoKey, secondaryImageKey, categories, hostProfile, pastEvents, brandsWorkedWith, ...rest }) => ({
        ...rest,
        logoUrl: logoKey ? await this.storageService.getPresignedDownloadUrl(logoKey) : null,
        secondaryImageUrl: secondaryImageKey ? await this.storageService.getPresignedDownloadUrl(secondaryImageKey) : null,
        categories: categories.map((c) => c.category),
        operatingCities: hostProfile?.operatingCities ?? [],
        socialLinks: hostProfile?.socialLinks ?? null,
        pastEvents: await signPastEvents(pastEvents),
        brandsWorkedWith: await this.withBrandsWorkedWithLogoUrls(brandsWorkedWith as BrandWorkedWithLike[] | null),
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

    const hostProfileId = await this.teamAccessService.resolveHostProfileId(userId);
    const hostProfile = await this.prisma.hostProfile.findUnique({
      where: { id: hostProfileId },
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
    const sponsorshipType = proposal.sponsorshipType || 'CASH';
    if (sponsorshipType !== 'BARTER' && !(proposal.sponsorTiers as unknown[])?.length) {
      missing.push('sponsorTiers');
    }

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

    // Deleting cascades to every SponsorshipInterest (and its chat messages/deal) on this
    // proposal — block it once a brand has expressed interest so a chat can never silently vanish.
    const interestCount = await this.prisma.sponsorshipInterest.count({ where: { sponsorshipProposalId: id } });
    if (interestCount > 0) {
      throw new BadRequestException(
        'This proposal has brand interest/chats on it and cannot be deleted, to avoid losing that conversation history.',
      );
    }

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
    const [hostProfileIds, brandProfileIds] = await Promise.all([
      this.teamAccessService.getHostProfileIds(userId),
      this.teamAccessService.getBrandProfileIds(userId),
    ]);
    return {
      hostProfile: hostProfileIds[0] ? { id: hostProfileIds[0] } : null,
      brandProfile: brandProfileIds[0] ? { id: brandProfileIds[0] } : null,
    };
  }

  async listMyChats(userId: string, query: ListSponsorshipChatsQueryDto) {
    const { hostProfile: originalHost, brandProfile: originalBrand } = await this.getOwnProfiles(userId);
    if (!originalHost && !originalBrand) throw new NotFoundException('No host or brand profile found for this account');

    const hostProfile = query.role === 'BRAND' ? null : originalHost;
    const brandProfile = query.role === 'HOST' ? null : originalBrand;

    const where: Prisma.SponsorshipInterestWhereInput = {
      ...(query.status && { chatStatus: query.status }),
      ...(hostProfile
        ? {
            OR: [
              { sponsorshipProposal: { hostProfileId: hostProfile.id } },
              { hostProfileId: hostProfile.id },
            ],
          }
        : { brandProfileId: brandProfile!.id }),
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
        campaign: {
          select: {
            id: true,
            name: true,
            brandProfile: { select: { brandName: true, logoKey: true } },
          },
        },
        hostProfile: {
          select: {
            id: true,
            displayName: true,
            communityProfile: { select: { name: true, logoKey: true } },
          },
        },
        brandProfile: { select: { id: true, brandName: true, logoKey: true } },
        chatMessages: { orderBy: { createdAt: 'desc' }, take: 1, select: { content: true, mediaKey: true, senderType: true, createdAt: true } },
        deal: { select: { id: true, status: true, report: { select: { id: true, status: true } } } },
      },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
    });

    const unreadStats = await Promise.all(
      interests.map(async (i) => {
        const lastReadAt = hostProfile ? i.hostLastReadAt : i.brandLastReadAt;
        const mySenderType = hostProfile ? ChatSenderType.HOST : ChatSenderType.BRAND;
        const unreadMessages = await this.prisma.sponsorshipChatMessage.findMany({
          where: {
            sponsorshipInterestId: i.id,
            senderType: { not: mySenderType },
            deletedAt: null,
            ...(lastReadAt && { createdAt: { gt: lastReadAt } }),
          },
          select: {
            id: true,
            content: true,
            replyTo: { select: { senderType: true } },
          },
        });

        const myKeywords: string[] = [];
        if (hostProfile) {
          myKeywords.push('host', 'community');
          const isCamp = !!i.campaignId;
          const hostName = isCamp
            ? i.hostProfile?.communityProfile?.name || i.hostProfile?.displayName
            : i.sponsorshipProposal?.hostProfile.communityProfile?.name || i.sponsorshipProposal?.hostProfile.displayName;
          if (hostName) myKeywords.push(hostName.toLowerCase());
        } else {
          myKeywords.push('brand');
          const isCamp = !!i.campaignId;
          const brandName = isCamp ? i.campaign?.brandProfile.brandName : i.brandProfile.brandName;
          if (brandName) myKeywords.push(brandName.toLowerCase());
        }

        const msgs = unreadMessages || [];
        const hasUnreadMention = msgs.some((msg) => {
          if (msg.replyTo && msg.replyTo.senderType === mySenderType) return true;
          if (msg.content) {
            const lower = msg.content.toLowerCase();
            return myKeywords.some((kw) => lower.includes(`@${kw}`) || (kw.length > 3 && lower.includes(`@${kw.replace(/\s+/g, '')}`)));
          }
          return false;
        });

        return {
          unreadCount: msgs.length,
          hasUnreadMention,
        };
      }),
    );

    const threads = await Promise.all(
      interests.map(async (i, idx) => {
        const isCampaign = !!i.campaignId;
        let counterpartLogoKey: string | null = null;
        if (hostProfile) {
          counterpartLogoKey = isCampaign ? i.campaign?.brandProfile.logoKey : i.brandProfile.logoKey;
        } else {
          counterpartLogoKey = isCampaign
            ? i.hostProfile?.communityProfile?.logoKey || null
            : i.sponsorshipProposal?.hostProfile.communityProfile?.logoKey || null;
        }

        const proposalId = isCampaign ? i.campaign?.id : i.sponsorshipProposal?.id;
        const proposalName = isCampaign ? i.campaign?.name : i.sponsorshipProposal?.name;

        let counterpartName = 'Community';
        if (hostProfile) {
          counterpartName = isCampaign ? i.campaign?.brandProfile.brandName : i.brandProfile.brandName;
        } else {
          counterpartName = isCampaign
            ? i.hostProfile?.communityProfile?.name ?? i.hostProfile?.displayName ?? 'Community'
            : i.sponsorshipProposal?.hostProfile.communityProfile?.name ?? i.sponsorshipProposal?.hostProfile.displayName ?? 'Community';
        }

        return {
          id: i.id,
          proposalId,
          proposalName,
          chatStatus: i.chatStatus,
          createdAt: i.createdAt,
          chatAcceptedAt: i.chatAcceptedAt,
          lastMessageAt: i.lastMessageAt,
          lastMessagePreview: i.chatMessages[0] ? (i.chatMessages[0].content || (i.chatMessages[0].mediaKey ? '📷 Photo' : '')).slice(0, 120) : null,
          unreadCount: unreadStats[idx].unreadCount,
          hasUnreadMention: unreadStats[idx].hasUnreadMention,
          counterpartName,
          counterpartAvatarUrl: counterpartLogoKey ? await this.storageService.getPresignedDownloadUrl(counterpartLogoKey) : null,
          sponsorshipProposalId: i.sponsorshipProposalId,
          campaignId: i.campaignId,
          isDealLocked: i.deal?.status === 'APPROVED',
          isDealClosed: i.deal?.status === 'APPROVED' && i.deal?.report?.status === 'APPROVED',
        };
      }),
    );

    return threads.sort((a, b) => {
      const timeA = new Date(a.lastMessageAt || a.createdAt).getTime();
      const timeB = new Date(b.lastMessageAt || b.createdAt).getTime();
      return timeB - timeA;
    });
  }

  // Shapes a replied-to message into the small quoted preview returned alongside a reply — shows
  // a placeholder instead of the real content if the original was since deleted.
  private replyToPreview(
    replyTo: { id: string; senderType: ChatSenderType; content: string; mediaKey: string | null; deletedAt: Date | null } | null,
  ) {
    if (!replyTo) return null;
    if (replyTo.deletedAt) {
      return { id: replyTo.id, senderType: replyTo.senderType, content: 'This message was deleted', hasMedia: false };
    }
    return { id: replyTo.id, senderType: replyTo.senderType, content: replyTo.content, hasMedia: !!replyTo.mediaKey };
  }

  // Verifies the caller is either the host or the brand on this interest and returns which "hat"
  // they're wearing, for use as senderType when they post a message. When the SAME account owns
  // both sides (a single email holding both a Brand and a Community/Host profile, self-interest),
  // isHost/isBrand are both true — preferredRole (from the caller, who knows which dashboard
  // they're acting from) disambiguates instead of always defaulting to HOST.
  private async getInterestForParticipant(userId: string, interestId: string, preferredRole?: 'HOST' | 'BRAND') {
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
        campaign: {
          select: {
            id: true,
            name: true,
            brandProfile: { select: { id: true, userId: true, brandName: true } },
          },
        },
        hostProfile: {
          select: {
            id: true,
            userId: true,
            displayName: true,
            communityProfile: { select: { name: true } },
          },
        },
        brandProfile: { select: { id: true, userId: true, brandName: true } },
      },
    });
    if (!interest) throw new NotFoundException('Chat thread not found');

    const isCampaign = !!interest.campaignId;
    const participantHostProfileId = isCampaign ? interest.hostProfile?.id : interest.sponsorshipProposal?.hostProfile.id;
    const participantHostUserId = isCampaign ? interest.hostProfile?.userId : interest.sponsorshipProposal?.hostProfile.userId;
    const participantBrandProfileId = isCampaign ? (interest.campaign?.brandProfile?.id ?? interest.brandProfile?.id) : interest.brandProfile?.id;
    const participantBrandUserId = isCampaign ? (interest.campaign?.brandProfile?.userId ?? interest.brandProfile?.userId) : interest.brandProfile?.userId;

    // Owner check first (cheap, no extra query) — team membership is an additional fallback.
    let isHost = participantHostUserId === userId;
    let isBrand = participantBrandUserId === userId;
    if (!isHost && !isBrand) {
      const [hostProfileIds, brandProfileIds] = await Promise.all([
        this.teamAccessService.getHostProfileIds(userId),
        this.teamAccessService.getBrandProfileIds(userId),
      ]);
      isHost = !!participantHostProfileId && hostProfileIds.includes(participantHostProfileId);
      isBrand = !!participantBrandProfileId && brandProfileIds.includes(participantBrandProfileId);
    }
    if (!isHost && !isBrand) throw new ForbiddenException('You do not have access to this chat');

    // Ambiguous only when both are true (self-interest edge case) — let the caller's hint break
    // the tie; otherwise fall back to the pre-existing HOST-first default for compatibility.
    const senderType =
      isHost && isBrand && preferredRole
        ? ChatSenderType[preferredRole]
        : isCampaign
        ? isBrand
          ? ChatSenderType.BRAND
          : ChatSenderType.HOST
        : isHost
        ? ChatSenderType.HOST
        : ChatSenderType.BRAND;

    return { interest, senderType, isHost, isBrand };
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
        replyTo: { select: { id: true, senderType: true, content: true, mediaKey: true, deletedAt: true } },
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
      messages.map(async ({ mediaKey, deletedAt, replyTo, ...m }) => {
        // Deleted messages are hidden from host/brand (placeholder only) — admin still sees the
        // original content via the separate admin endpoint, which doesn't go through this path.
        if (deletedAt) {
          return { ...m, content: '', mediaUrl: null, deletedAt, seenByOther: false, replyTo: this.replyToPreview(replyTo) };
        }
        return {
          ...m,
          deletedAt: null,
          mediaUrl: mediaKey ? await this.storageService.getPresignedDownloadUrl(mediaKey) : null,
          seenByOther: m.senderType === senderType && !!otherLastReadAt && m.createdAt <= otherLastReadAt,
          replyTo: this.replyToPreview(replyTo),
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
      include: { replyTo: { select: { id: true, senderType: true, content: true, mediaKey: true, deletedAt: true } } },
    });

    const { replyTo, ...rest } = updated;
    const mediaUrl = updated.mediaKey ? await this.storageService.getPresignedDownloadUrl(updated.mediaKey) : null;
    return { ...rest, mediaUrl, wasRedacted, replyTo: this.replyToPreview(replyTo) };
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
    const { interest, senderType } = await this.getInterestForParticipant(userId, interestId, dto.asRole);
    if (interest.chatStatus !== SponsorshipChatStatus.ACCEPTED) {
      throw new BadRequestException('The community must accept this request before you can chat.');
    }
    if (!dto.content?.trim() && !dto.mediaKey) {
      throw new BadRequestException('Message must have text or an image');
    }

    let replyToRow: { id: string; senderType: ChatSenderType; content: string; mediaKey: string | null; deletedAt: Date | null } | null = null;
    if (dto.replyToId) {
      const original = await this.prisma.sponsorshipChatMessage.findUnique({
        where: { id: dto.replyToId },
        select: { id: true, senderType: true, content: true, mediaKey: true, deletedAt: true, sponsorshipInterestId: true },
      });
      if (!original || original.sponsorshipInterestId !== interest.id) {
        throw new BadRequestException('You can only reply to a message in this chat');
      }
      replyToRow = original;
    }

    // Contact info must stay off-platform-conversation — redact emails/phone numbers so hosts
    // and brands can't route around Meetday, and tell the sender why in the response.
    const { content, wasRedacted } = dto.content ? redactPersonalInfo(dto.content) : { content: '', wasRedacted: false };

    const message = await this.prisma.sponsorshipChatMessage.create({
      data: { sponsorshipInterestId: interest.id, senderType, senderId: userId, content, mediaKey: dto.mediaKey, replyToId: dto.replyToId },
    });
    await this.prisma.sponsorshipInterest.update({
      where: { id: interest.id },
      data: {
        lastMessageAt: message.createdAt,
        // Sending also counts as having read up to now, on my own side.
        ...(senderType === ChatSenderType.HOST ? { hostLastReadAt: message.createdAt } : { brandLastReadAt: message.createdAt }),
      },
    });

    const isCampaign = !!interest.campaignId;
    const hostUserId = isCampaign ? interest.hostProfile?.userId : interest.sponsorshipProposal?.hostProfile?.userId;
    const recipientUserId =
      senderType === ChatSenderType.HOST ? interest.brandProfile.userId : hostUserId;
    
    let senderName = 'The community';
    if (senderType === ChatSenderType.HOST) {
      const host = isCampaign ? interest.hostProfile : interest.sponsorshipProposal?.hostProfile;
      senderName = host?.communityProfile?.name ?? host?.displayName ?? 'The community';
    } else {
      senderName = interest.brandProfile.brandName;
    }
    const preview = content.trim() ? content.slice(0, 80) : '📷 Sent a photo';
    // A single Firebase identity can hold both a host AND a brand profile (see register()) —
    // if the same account is on both sides of this chat, recipientUserId resolves to the
    // sender's own id, and without this guard they'd hear a notification chime for their own
    // just-sent message.
    if (recipientUserId && recipientUserId !== userId) {
      void this.notificationsService
        .create(recipientUserId, 'sponsorship_chat_message', senderName, preview, {
          sponsorshipInterestId: interest.id,
        })
        .catch((err) => this.logger.error('Failed to notify of new chat message', err));
      this.scheduleUnreadChatEmail(interest.id, recipientUserId);
    }

    const mediaUrl = dto.mediaKey ? await this.storageService.getPresignedDownloadUrl(dto.mediaKey) : null;
    return { ...message, mediaUrl, wasRedacted, replyTo: this.replyToPreview(replyToRow) };
  }


  // Host accepts a brand's interest OR brand accepts a host's interest (for campaigns) — opens the chat window both sides ("Requests" → "General").
  async acceptChatRequest(userId: string, interestId: string) {
    const { interest, isHost, isBrand } = await this.getInterestForParticipant(userId, interestId);
    const isCampaign = !!interest.campaignId;

    if (isCampaign) {
      if (!isBrand) throw new ForbiddenException('Only the brand can accept this request');
    } else {
      if (!isHost) throw new ForbiddenException('Only the host can accept this request');
    }

    if (interest.chatStatus === SponsorshipChatStatus.ACCEPTED) {
      return { message: 'Already accepted', chatStatus: interest.chatStatus };
    }

    const updated = await this.prisma.sponsorshipInterest.update({
      where: { id: interestId },
      data: { chatStatus: SponsorshipChatStatus.ACCEPTED, chatAcceptedAt: new Date() },
    });

    const hostUserId = isCampaign ? (interest.hostProfile?.userId ?? interest.sponsorshipProposal?.hostProfile?.userId) : (interest.sponsorshipProposal?.hostProfile?.userId ?? interest.hostProfile?.userId);
    const brandUserId = isCampaign ? (interest.campaign?.brandProfile?.userId ?? interest.brandProfile?.userId) : interest.brandProfile?.userId;
    const recipientUserId = isCampaign ? hostUserId : brandUserId;
    const brandName = interest.campaign?.brandProfile?.brandName ?? interest.brandProfile?.brandName ?? 'Brand';
    const title = 'Request accepted!';
    const body = isCampaign
      ? `${brandName} accepted your interest — you can now chat with them.`
      : 'The community accepted your interest — you can now chat with them.';

    if (recipientUserId) {
      void this.notificationsService
        .create(
          recipientUserId,
          'sponsorship_chat_accepted',
          title,
          body,
          { sponsorshipInterestId: interestId },
        )
        .catch((err) => this.logger.error('Failed to notify of accepted chat request', err));
    }

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

  private hostNameOf(interest: any) {
    if (interest.campaignId && interest.hostProfile) {
      return interest.hostProfile.communityProfile?.name ?? interest.hostProfile.displayName ?? 'The community';
    }
    return interest.sponsorshipProposal?.hostProfile?.communityProfile?.name ?? interest.sponsorshipProposal?.hostProfile?.displayName ?? 'The community';
  }

  async createDeal(userId: string, interestId: string, dto: UpsertSponsorshipDealDto) {
    const { interest, isHost, isBrand } = await this.getInterestForParticipant(userId, interestId);
    const isCampaign = !!interest.campaignId;
    if (isCampaign) {
      if (!isBrand) {
        throw new ForbiddenException('Only the brand can lock a deal for a campaign');
      }
    } else {
      if (!isHost) {
        throw new ForbiddenException('Only the community can lock a deal');
      }
    }
    const senderType = isCampaign ? ChatSenderType.BRAND : ChatSenderType.HOST;
    if (interest.chatStatus !== SponsorshipChatStatus.ACCEPTED) {
      throw new BadRequestException('The chat must be accepted before locking a deal');
    }

    const existing = await this.prisma.sponsorshipDeal.findUnique({ where: { sponsorshipInterestId: interest.id } });
    if (existing) throw new BadRequestException('A deal already exists for this chat — use edit instead');

    const deal = await this.prisma.sponsorshipDeal.create({
      data: {
        sponsorshipInterestId: interest.id,
        projectName: dto.projectName,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        time: dto.time,
        sponsorshipCategory: dto.sponsorshipCategory,
        sponsorshipAmount: dto.sponsorshipAmount,
        venue: dto.venue,
        barterElements: dto.barterElements,
        deliverables: dto.deliverables,
        otherTerms: dto.otherTerms,
        additionalNotes: dto.additionalNotes,
        createdById: userId,
      },
    });

    const hostName = this.hostNameOf(interest);
    const brandName = interest.campaign?.brandProfile?.brandName ?? interest.brandProfile?.brandName ?? 'The brand';
    const creatorName = isCampaign ? brandName : hostName;
    const targetUserId = isCampaign
      ? (interest.hostProfile?.userId ?? interest.sponsorshipProposal?.hostProfile?.userId)
      : interest.brandProfile?.userId;

    await this.postDealSystemMessage(
      interest.id,
      senderType,
      userId,
      isCampaign
        ? `${creatorName} shared a campaign deal for your approval.`
        : `${creatorName} shared a deal proposal for your approval.`,
    );

    if (targetUserId) {
      void this.notificationsService
        .create(
          targetUserId,
          'sponsorship_deal_submitted',
          creatorName,
          isCampaign ? `Shared a campaign deal: ${dto.projectName}` : `Shared a deal proposal: ${dto.projectName}`,
          {
            sponsorshipInterestId: interest.id,
          },
        )
        .catch((err) => this.logger.error('Failed to notify counterparty of new deal proposal', err));
    }

    return deal;
  }

  async updateDeal(userId: string, interestId: string, dto: UpsertSponsorshipDealDto) {
    const { interest, isHost, isBrand } = await this.getInterestForParticipant(userId, interestId);
    const isCampaign = !!interest.campaignId;
    if (isCampaign) {
      if (!isBrand) {
        throw new ForbiddenException('Only the brand can edit the deal for a campaign');
      }
    } else {
      if (!isHost) {
        throw new ForbiddenException('Only the community can edit the deal');
      }
    }
    const senderType = isCampaign ? ChatSenderType.BRAND : ChatSenderType.HOST;

    const existing = await this.prisma.sponsorshipDeal.findUnique({ where: { sponsorshipInterestId: interest.id } });
    if (!existing) throw new NotFoundException('No deal found for this chat — lock a deal first');
    if (existing.status === 'APPROVED') throw new BadRequestException('This deal is already locked and cannot be edited');

    const deal = await this.prisma.sponsorshipDeal.update({
      where: { id: existing.id },
      data: {
        projectName: dto.projectName,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        time: dto.time,
        sponsorshipCategory: dto.sponsorshipCategory,
        sponsorshipAmount: dto.sponsorshipAmount,
        venue: dto.venue,
        barterElements: dto.barterElements,
        deliverables: dto.deliverables,
        otherTerms: dto.otherTerms,
        additionalNotes: dto.additionalNotes,
        status: 'PENDING_APPROVAL',
        changeRequestNote: null,
        version: { increment: 1 },
      },
    });

    const hostName = this.hostNameOf(interest);
    const brandName = interest.campaign?.brandProfile?.brandName ?? interest.brandProfile?.brandName ?? 'The brand';
    const creatorName = isCampaign ? brandName : hostName;
    const targetUserId = isCampaign
      ? (interest.hostProfile?.userId ?? interest.sponsorshipProposal?.hostProfile?.userId)
      : interest.brandProfile?.userId;

    await this.postDealSystemMessage(
      interest.id,
      senderType,
      userId,
      isCampaign
        ? `${creatorName} updated the campaign deal.`
        : `${creatorName} updated the deal proposal.`,
    );

    if (targetUserId && targetUserId !== userId) {
      void this.notificationsService
        .create(
          targetUserId,
          'sponsorship_deal_updated',
          creatorName,
          isCampaign ? `Updated the campaign deal: ${dto.projectName}` : `Updated the deal proposal: ${dto.projectName}`,
          {
            sponsorshipInterestId: interest.id,
          },
        )
        .catch((err) => this.logger.error('Failed to notify counterparty of updated deal proposal', err));
    }

    return deal;
  }

  async approveDeal(userId: string, interestId: string) {
    const { interest, isHost, isBrand } = await this.getInterestForParticipant(userId, interestId);
    const isCampaign = !!interest.campaignId;
    if (isCampaign) {
      if (!isHost) {
        throw new ForbiddenException('Only the community can accept the deal for a campaign');
      }
    } else {
      if (!isBrand) {
        throw new ForbiddenException('Only the brand can approve the deal');
      }
    }
    const senderType = isCampaign ? ChatSenderType.HOST : ChatSenderType.BRAND;

    const existing = await this.prisma.sponsorshipDeal.findUnique({ where: { sponsorshipInterestId: interest.id } });
    if (!existing) throw new NotFoundException('No deal found for this chat');
    if (existing.status === 'APPROVED') return existing;

    const paymentExpiresAt = new Date();
    paymentExpiresAt.setDate(paymentExpiresAt.getDate() + DEAL_PAYMENT_DUE_DAYS);

    const deal = await this.prisma.sponsorshipDeal.update({
      where: { id: existing.id },
      data: { status: 'APPROVED', approvedAt: new Date(), paymentExpiresAt },
    });

    await this.postDealSystemMessage(interest.id, senderType, userId, 'Congratulations! The deal is locked.');

    const hostName = this.hostNameOf(interest);
    const brandName = interest.campaign?.brandProfile?.brandName ?? interest.brandProfile?.brandName ?? 'The brand';
    const approverName = isCampaign ? hostName : brandName;
    const targetUserId = isCampaign
      ? interest.brandProfile?.userId
      : (interest.hostProfile?.userId ?? interest.sponsorshipProposal?.hostProfile?.userId);

    if (targetUserId) {
      void this.notificationsService
        .create(
          targetUserId,
          'sponsorship_deal_locked',
          approverName,
          `Approved and locked the deal: ${existing.projectName}`,
          { sponsorshipInterestId: interest.id },
        )
        .catch((err) => this.logger.error('Failed to notify counterparty of locked deal', err));
    }

    const admins = await this.prisma.user.findMany({
      where: { isActive: true, role: { name: { in: ADMIN_ROLES } } },
      select: { id: true },
    });
    void Promise.allSettled(
      admins.map((admin) =>
        this.notificationsService.create(
          admin.id,
          'sponsorship_deal_locked',
          'Deal locked',
          `${hostName} × ${brandName}: "${existing.projectName}" is now locked.`,
          { sponsorshipInterestId: interest.id },
        ),
      ),
    );

    return deal;
  }

  async requestDealChanges(userId: string, interestId: string, dto: RequestDealChangesDto) {
    const { interest, isHost, isBrand } = await this.getInterestForParticipant(userId, interestId);
    const isCampaign = !!interest.campaignId;
    if (isCampaign) {
      if (!isHost) {
        throw new ForbiddenException('Only the community can request changes for a campaign');
      }
    } else {
      if (!isBrand) {
        throw new ForbiddenException('Only the brand can request changes');
      }
    }
    const senderType = isCampaign ? ChatSenderType.HOST : ChatSenderType.BRAND;

    const existing = await this.prisma.sponsorshipDeal.findUnique({ where: { sponsorshipInterestId: interest.id } });
    if (!existing) throw new NotFoundException('No deal found for this chat');
    if (existing.status === 'APPROVED') throw new BadRequestException('This deal is already locked');

    const deal = await this.prisma.sponsorshipDeal.update({
      where: { id: existing.id },
      data: { status: 'CHANGES_REQUESTED', changeRequestNote: dto.note ?? null },
    });

    const hostName = this.hostNameOf(interest);
    const brandName = interest.campaign?.brandProfile?.brandName ?? interest.brandProfile?.brandName ?? 'The brand';
    const requesterName = isCampaign ? hostName : brandName;
    const targetUserId = isCampaign
      ? interest.brandProfile?.userId
      : (interest.hostProfile?.userId ?? interest.sponsorshipProposal?.hostProfile?.userId);

    const noteSuffix = dto.note?.trim() ? `: "${dto.note.trim()}"` : '.';
    await this.postDealSystemMessage(
      interest.id,
      senderType,
      userId,
      `${requesterName} requested changes to the deal${noteSuffix}`,
    );

    if (targetUserId) {
      void this.notificationsService
        .create(
          targetUserId,
          'sponsorship_deal_changes_requested',
          requesterName,
          dto.note?.trim() ? `Requested changes: ${dto.note.trim()}` : 'Requested changes to the deal',
          { sponsorshipInterestId: interest.id },
        )
        .catch((err) => this.logger.error('Failed to notify counterparty of requested deal changes', err));
    }

    return deal;
  }

  // ── Submit Report: host reports on completed deliverables once the deal is locked ──────

  async getDealReport(userId: string, interestId: string) {
    const { interest } = await this.getInterestForParticipant(userId, interestId);
    const deal = await this.prisma.sponsorshipDeal.findUnique({ where: { sponsorshipInterestId: interest.id } });
    if (!deal) throw new NotFoundException('No deal found for this chat');

    const report = await this.prisma.sponsorshipDealReport.findUnique({ where: { sponsorshipDealId: deal.id } });
    if (!report) return null;

    const proofUrls = await Promise.all(report.proofKeys.map((key) => this.storageService.getPresignedDownloadUrl(key)));
    return { ...report, proofUrls };
  }

  async upsertDealReport(userId: string, interestId: string, dto: UpsertSponsorshipDealReportDto) {
    const { interest, senderType } = await this.getInterestForParticipant(userId, interestId);

    const deal = await this.prisma.sponsorshipDeal.findUnique({ where: { sponsorshipInterestId: interest.id } });
    if (!deal) throw new NotFoundException('No deal found for this chat');
    if (deal.status !== 'APPROVED') {
      throw new BadRequestException('The deal must be locked and approved before submitting a report');
    }

    const existingReport = await this.prisma.sponsorshipDealReport.findUnique({ where: { sponsorshipDealId: deal.id } });
    // Brand can only approve/request-revision on an already-submitted report, not create one.
    if (senderType !== ChatSenderType.HOST && !existingReport) {
      throw new ForbiddenException('Only the community can submit the deliverables report');
    }

    const report = await this.prisma.sponsorshipDealReport.upsert({
      where: { sponsorshipDealId: deal.id },
      create: {
        sponsorshipDealId: deal.id,
        projectName: dto.projectName ?? 'Project',
        eventDate: dto.eventDate ?? '',
        venue: dto.venue ?? '',
        time: dto.time,
        guestCount: dto.guestCount,
        ageRange: dto.ageRange,
        deliverables: dto.deliverables ?? [],
        videoLinks: dto.videoLinks ?? [],
        socialLinks: dto.socialLinks ?? [],
        status: dto.status ?? 'PENDING',
        revisionNote: dto.revisionNote,
        summary: dto.summary,
        proofKeys: dto.proofKeys ?? [],
        notes: dto.notes,
        submittedById: userId,
      },
      update: {
        projectName: dto.projectName ?? 'Project',
        eventDate: dto.eventDate ?? '',
        venue: dto.venue ?? '',
        time: dto.time,
        guestCount: dto.guestCount,
        ageRange: dto.ageRange,
        deliverables: dto.deliverables ?? [],
        videoLinks: dto.videoLinks ?? [],
        socialLinks: dto.socialLinks ?? [],
        status: dto.status ?? 'PENDING',
        revisionNote: dto.revisionNote,
        summary: dto.summary,
        proofKeys: dto.proofKeys ?? [],
        notes: dto.notes,
        submittedById: userId,
      },
    });

    if (senderType === ChatSenderType.HOST) {
      await this.postDealSystemMessage(
        interest.id,
        ChatSenderType.HOST,
        userId,
        `${this.hostNameOf(interest)} submitted the deliverables report.`,
      );

      void this.notificationsService
        .create(
          interest.brandProfile.userId,
          'sponsorship_deal_report_submitted',
          this.hostNameOf(interest),
          'Submitted the deliverables report for your locked deal',
          { sponsorshipInterestId: interest.id },
        )
        .catch((err) => this.logger.error('Failed to notify brand of submitted deal report', err));
    } else {
      // Brand approving/requesting revision — best-effort read of the status the frontend
      // embeds in the summary JSON, since it isn't sent as a top-level dto field.
      let brandStatus = 'reviewed';
      try {
        brandStatus = JSON.parse(dto.summary)?.status === 'APPROVED' ? 'approved' : 'requested changes to';
      } catch {
        /* keep generic wording */
      }
      await this.postDealSystemMessage(
        interest.id,
        ChatSenderType.BRAND,
        userId,
        `${interest.brandProfile.brandName} ${brandStatus} the deliverables report.`,
      );

      void this.notificationsService
        .create(
          interest.campaignId ? interest.hostProfile?.userId : interest.sponsorshipProposal?.hostProfile?.userId,
          'sponsorship_deal_report_reviewed',
          interest.brandProfile.brandName,
          `${brandStatus === 'approved' ? 'Approved' : 'Requested changes to'} your deliverables report`,
          { sponsorshipInterestId: interest.id },
        )
        .catch((err) => this.logger.error('Failed to notify host of report review', err));
    }

    const proofUrls = await Promise.all(report.proofKeys.map((key) => this.storageService.getPresignedDownloadUrl(key)));
    return { ...report, proofUrls };
  }

  async initiateDealPayment(userId: string, interestId: string) {
    const { interest, senderType } = await this.getInterestForParticipant(userId, interestId);
    if (senderType !== ChatSenderType.BRAND) throw new ForbiddenException('Only the brand can pay for this deal');

    const deal = await this.prisma.sponsorshipDeal.findUnique({ where: { sponsorshipInterestId: interest.id } });
    if (!deal) throw new NotFoundException('No deal found for this chat');
    if (deal.status !== 'APPROVED') throw new BadRequestException('The deal must be locked before it can be paid for');
    if (deal.paymentStatus === 'PAID') throw new BadRequestException('This deal has already been paid for');

    if (deal.razorpayOrderId && deal.totalAmount) {
      const amountInPaise = Math.round(Number(deal.totalAmount) * 100);
      return { razorpayOrderId: deal.razorpayOrderId, amount: amountInPaise, currency: 'INR', keyId: this.razorpayKeyId };
    }

    const { platformFeeAmount, transactionFeeAmount, taxAmount, totalAmount } = await this.computeDealPaymentBreakdown(Number(deal.sponsorshipAmount));
    const amountInPaise = Math.round(totalAmount * 100);
    if (amountInPaise < 100) throw new BadRequestException('Deal amount is below the minimum chargeable amount');

    let razorpayOrder: any;
    try {
      razorpayOrder = await this.razorpay.orders.create({
        amount: amountInPaise,
        currency: 'INR',
        receipt: deal.id,
      });
    } catch (err: any) {
      const rzpError = err?.error ?? err;
      this.logger.error(`Razorpay order creation failed [${rzpError?.code ?? 'UNKNOWN'}]: ${rzpError?.description ?? err?.message}`);
      if (err?.statusCode === 400) throw new BadRequestException(rzpError?.description ?? 'Payment initiation failed');
      throw new InternalServerErrorException('Payment gateway error. Please try again later.');
    }

    await this.prisma.sponsorshipDeal.update({
      where: { id: deal.id },
      data: { razorpayOrderId: razorpayOrder.id, platformFeeAmount, transactionFeeAmount, taxAmount, totalAmount },
    });

    this.logger.log(`Razorpay order created: ${razorpayOrder.id} for sponsorship deal: ${deal.id}`);

    return { razorpayOrderId: razorpayOrder.id, amount: amountInPaise, currency: 'INR', keyId: this.razorpayKeyId };
  }

  async verifyDealPayment(userId: string, interestId: string, dto: VerifySponsorshipDealPaymentDto) {
    const { interest, senderType } = await this.getInterestForParticipant(userId, interestId);
    if (senderType !== ChatSenderType.BRAND) throw new ForbiddenException('Only the brand can pay for this deal');

    const deal = await this.prisma.sponsorshipDeal.findUnique({ where: { sponsorshipInterestId: interest.id } });
    if (!deal) throw new NotFoundException('No deal found for this chat');
    if (deal.paymentStatus === 'PAID') return deal;
    if (deal.razorpayOrderId !== dto.razorpayOrderId) throw new BadRequestException('Razorpay order ID does not match this deal');

    const expectedSignature = createHmac('sha256', this.razorpayKeySecret)
      .update(`${dto.razorpayOrderId}|${dto.razorpayPaymentId}`)
      .digest('hex');
    if (expectedSignature !== dto.razorpaySignature) {
      this.logger.warn(`Signature mismatch for sponsorship deal ${deal.id}`);
      throw new UnauthorizedException('Invalid payment signature');
    }

    const updated = await this.prisma.sponsorshipDeal.update({
      where: { id: deal.id },
      data: { paymentStatus: 'PAID', paymentMode: 'ONLINE', razorpayPaymentId: dto.razorpayPaymentId, paidAt: new Date() },
    });

    const paidAmount = Number(deal.totalAmount ?? deal.sponsorshipAmount);
    await this.postDealSystemMessage(
      interest.id,
      ChatSenderType.BRAND,
      userId,
      `${interest.brandProfile.brandName} paid ₹${paidAmount.toLocaleString('en-IN')} for the deal.`,
    );

    void this.notificationsService
      .create(
        interest.campaignId ? interest.hostProfile?.userId : interest.sponsorshipProposal?.hostProfile?.userId,
        'sponsorship_deal_paid',
        interest.brandProfile.brandName,
        `💳 Paid ₹${paidAmount.toLocaleString('en-IN')} for the deal: ${deal.projectName}`,
        { sponsorshipInterestId: interest.id },
      )
      .catch((err) => this.logger.error('Failed to notify host of deal payment', err));

    return updated;
  }

  private async getGstRate(): Promise<number> {
    const config = await this.prisma.platformConfig.findUnique({ where: { key: 'gst_rate' } });
    return config ? parseFloat(config.value) : DEFAULT_SPONSORSHIP_GST_RATE;
  }

  private async computeDealPaymentBreakdown(sponsorshipAmount: number) {
    const gstRate = await this.getGstRate();
    return computeDealPaymentBreakdownUtil(sponsorshipAmount, gstRate);
  }

  // ── Billing: brand-facing list of all locked deals across chats, with payment breakdown ──

  async listBrandDealsBilling(userId: string) {
    const id = await this.teamAccessService.resolveBrandProfileId(userId);
    const brandProfile = await this.prisma.brandProfile.findUnique({ where: { id }, select: { id: true } });
    if (!brandProfile) throw new NotFoundException('Brand profile not found');

    const deals = await this.prisma.sponsorshipDeal.findMany({
      where: {
        status: 'APPROVED',
        sponsorshipInterest: {
          OR: [
            { brandProfileId: brandProfile.id },
            { campaign: { brandProfileId: brandProfile.id } },
          ],
        },
      },
      include: {
        sponsorshipInterest: {
          select: {
            id: true,
            campaignId: true,
            sponsorshipProposalId: true,
            sponsorshipProposal: {
              select: { id: true, name: true, hostProfile: { select: { displayName: true, communityProfile: { select: { name: true } } } } },
            },
            campaign: {
              select: { id: true, name: true },
            },
            hostProfile: {
              select: { id: true, displayName: true, communityProfile: { select: { name: true } } },
            },
          },
        },
      },
      orderBy: [{ approvedAt: 'desc' }],
    });

    return Promise.all(
      deals.map(async (d) => {
        // Breakdown is only persisted once a Razorpay order is created (payment initiated) or an
        // admin marks it paid offline. Before that, compute it live so the brand can see it before
        // ever clicking "Pay". platformFeeAmount is intentionally always null so it can't be used
        // as the "is it persisted" signal.
        const breakdown =
          d.transactionFeeAmount != null
            ? { platformFeeAmount: d.platformFeeAmount, transactionFeeAmount: d.transactionFeeAmount, taxAmount: d.taxAmount, totalAmount: d.totalAmount }
            : await this.computeDealPaymentBreakdown(Number(d.sponsorshipAmount));

        const isCampaign = !!d.sponsorshipInterest.campaignId;
        const proposalName = isCampaign
          ? d.sponsorshipInterest.campaign?.name
          : d.sponsorshipInterest.sponsorshipProposal?.name;

        let communityName = 'Community';
        if (isCampaign) {
          communityName = d.sponsorshipInterest.hostProfile?.communityProfile?.name ?? d.sponsorshipInterest.hostProfile?.displayName ?? 'Community';
        } else {
          communityName = d.sponsorshipInterest.sponsorshipProposal?.hostProfile.communityProfile?.name ?? d.sponsorshipInterest.sponsorshipProposal?.hostProfile.displayName ?? 'Community';
        }

        return {
          id: d.id,
          sponsorshipInterestId: d.sponsorshipInterest.id,
          proposalName,
          communityName,
          projectName: d.projectName,
          sponsorshipAmount: d.sponsorshipAmount,
          ...breakdown,
          paymentStatus: d.paymentStatus,
          paymentMode: d.paymentMode,
          paymentExpiresAt: d.paymentExpiresAt,
          paidAt: d.paidAt,
          approvedAt: d.approvedAt,
          razorpayPaymentId: d.razorpayPaymentId,
          invoicePdfKey: d.invoicePdfKey,
          isCampaign,
          campaignId: d.sponsorshipInterest.campaignId,
          sponsorshipProposalId: d.sponsorshipInterest.sponsorshipProposalId,
        };
      }),
    );
  }
}
