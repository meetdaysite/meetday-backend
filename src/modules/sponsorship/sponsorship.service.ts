import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Prisma, SponsorshipStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CreateProposalDto } from './dto/create-proposal.dto';
import { UpdateProposalDto } from './dto/update-proposal.dto';
import { ListProposalsQueryDto } from './dto/list-proposals-query.dto';
import { ListPublishedQueryDto } from './dto/list-published-query.dto';
import { ADMIN_ALERT_EMAILS } from '../../common/mail/admin-recipients.constant';

const ADMIN_ROLES = ['SUPER_ADMIN', 'CITY_ADMIN', 'MODERATOR'];

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

  // Resolves stored keys (top-level + pendingRevision, if present) to presigned download URLs.
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
      const { categories, logoKey, ...communityRest } = communityProfile;
      community = {
        ...communityRest,
        logoUrl: logoKey ? await this.storageService.getPresignedDownloadUrl(logoKey) : null,
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
        user: { select: { email: true } },
        categories: { select: { category: { select: { name: true } } } },
      },
    });
    if (!brandProfile) throw new NotFoundException('Brand profile not found');

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

    // Host/community notification is intentionally anonymized — never reveal the brand's identity.
    void this.notificationsService
      .create(
        proposal.hostProfile.user.id,
        'brand_interested_in_sponsorship',
        'Someone is interested!',
        'A brand is interested in your project.',
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
      profiles.map(async ({ logoKey, categories, hostProfile, ...rest }) => ({
        ...rest,
        logoUrl: logoKey ? await this.storageService.getPresignedDownloadUrl(logoKey) : null,
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
}
