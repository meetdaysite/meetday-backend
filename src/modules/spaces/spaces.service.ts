import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ADMIN_ALERT_EMAILS } from '../../common/mail/admin-recipients.constant';
import { UpdateSpaceProfileDto } from './dto/update-space-profile.dto';
import { ActivateSpaceCommunityDto } from './dto/activate-space-community.dto';

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
}
