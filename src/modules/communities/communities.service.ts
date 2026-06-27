import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  CommunityAccess,
  CommunityEventSource,
  CommunityMemberStatus,
  CommunityRole,
  CommunityStatus,
  CommunityType,
  ConsentType,
  EventStatus,
  InterestAffinity,
  MemberVisibility,
  OrderStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ConsentService } from '../consent/consent.service';
import { CreateCommunityDto } from './dto/create-community.dto';
import { UpdateCommunityDto } from './dto/update-community.dto';
import { UpdateCommunitySettingsDto } from './dto/update-community-settings.dto';
import { SetCommunityInterestsDto } from './dto/set-community-interests.dto';
import { SetCommunityCitiesDto } from './dto/set-community-cities.dto';
import { AssignMemberDto } from './dto/assign-member.dto';
import { AddCommunityEventDto } from './dto/add-community-event.dto';
import { ListCommunitiesQueryDto } from './dto/list-communities-query.dto';
import { ListSavedCommunitiesQueryDto } from './dto/list-saved-communities-query.dto';
import { ListJoinedCommunitiesQueryDto } from './dto/list-joined-communities-query.dto';
import { RecommendCommunitiesQueryDto } from './dto/recommend-communities-query.dto';
import { JoinCommunityDto } from './dto/join-community.dto';
import { AudienceSize, HostCommunityTab, ListHostCommunitiesQueryDto } from './dto/list-host-communities-query.dto';

const COMMUNITY_DETAIL_INCLUDE = {
  settings: true,
  category: { select: { id: true, name: true } },
  interests: { include: { interest: { select: { id: true, name: true, slug: true } } } },
  members: {
    include: { user: { select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true } } },
  },
  events: {
    include: { event: { select: { id: true, title: true, city: true, eventDate: true, status: true } } },
  },
} satisfies Prisma.CommunityInclude;

const ENTITY_TYPE = 'COMMUNITY';

@Injectable()
export class CommunitiesService {
  private readonly logger = new Logger(CommunitiesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly auditLogService: AuditLogService,
    private readonly consentService: ConsentService,
  ) {}

  // ─── Create / Update ────────────────────────────────────────────────────────

  async create(adminId: string, dto: CreateCommunityDto) {
    await this.assertSlugAvailable(dto.slug);

    const community = await this.prisma.community.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        type: dto.type,
        description: dto.description,
        categoryId: dto.categoryId,
        primaryCity: dto.primaryCity,
        interestTags: dto.interestTags ?? [],
        coverImageKey: dto.coverImageKey,
        iconKey: dto.iconKey,
        createdBy: adminId,
        // The creator is persisted as the OWNER member.
        members: {
          create: {
            userId: adminId,
            role: CommunityRole.OWNER,
            status: CommunityMemberStatus.ACTIVE,
            joinedAt: new Date(),
          },
        },
        settings: { create: {} },
      },
    });

    await this.prisma.community.update({
      where: { id: community.id },
      data: { memberCount: 1 },
    });

    this.auditLogService.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: AuditAction.COMMUNITY_CREATED,
      entityType: ENTITY_TYPE,
      entityId: community.id,
    });

    return this.findOneForAdmin(community.id);
  }

  async update(id: string, dto: UpdateCommunityDto) {
    await this.assertExists(id);
    if (dto.slug) await this.assertSlugAvailable(dto.slug, id);

    await this.prisma.community.update({
      where: { id },
      data: {
        name: dto.name,
        slug: dto.slug,
        type: dto.type,
        description: dto.description,
        categoryId: dto.categoryId,
        interestTags: dto.interestTags,
        access: dto.access,
        memberVisibility: dto.memberVisibility,
        coverImageKey: dto.coverImageKey,
        iconKey: dto.iconKey,
        autoAddMatchingEvents: dto.autoAddMatchingEvents,
      },
    });

    this.logUpdate(id);
    return this.findOneForAdmin(id);
  }

  async updateSettings(id: string, dto: UpdateCommunitySettingsDto) {
    await this.assertExists(id);

    await this.prisma.communitySettings.upsert({
      where: { communityId: id },
      create: { communityId: id, ...dto },
      update: { ...dto },
    });

    this.logUpdate(id);
    return this.findOneForAdmin(id);
  }

  async setInterests(id: string, dto: SetCommunityInterestsDto) {
    await this.assertExists(id);

    const interestIds = [...new Set(dto.interestIds)];
    if (interestIds.length) {
      const found = await this.prisma.interest.count({ where: { id: { in: interestIds } } });
      if (found !== interestIds.length) throw new BadRequestException('One or more interestIds are invalid');
    }

    await this.prisma.$transaction([
      this.prisma.communityInterest.deleteMany({ where: { communityId: id } }),
      this.prisma.communityInterest.createMany({
        data: interestIds.map((interestId) => ({ communityId: id, interestId })),
        skipDuplicates: true,
      }),
    ]);

    this.logUpdate(id);
    return this.findOneForAdmin(id);
  }

  async setCities(id: string, dto: SetCommunityCitiesDto) {
    await this.assertExists(id);

    await this.prisma.community.update({
      where: { id },
      data: { primaryCity: dto.primaryCity, communityCities: dto.communityCities },
    });

    this.logUpdate(id);
    return this.findOneForAdmin(id);
  }

  // ─── Members (roles) ─────────────────────────────────────────────────────────

  async assignMember(id: string, adminId: string, dto: AssignMemberDto) {
    await this.assertExists(id);

    if (dto.role === CommunityRole.OWNER) {
      throw new BadRequestException('Owner is assigned at creation and cannot be added as a member role');
    }

    const user = await this.prisma.user.findUnique({ where: { id: dto.userId }, select: { id: true } });
    if (!user) throw new NotFoundException('User not found');

    const member = await this.prisma.communityMember.upsert({
      where: { communityId_userId: { communityId: id, userId: dto.userId } },
      create: {
        communityId: id,
        userId: dto.userId,
        role: dto.role,
        status: CommunityMemberStatus.ACTIVE,
        invitedBy: adminId,
        joinedAt: new Date(),
      },
      update: { role: dto.role, status: CommunityMemberStatus.ACTIVE },
    });

    await this.recalculateMemberCount(id);

    this.auditLogService.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: AuditAction.COMMUNITY_MEMBER_ADDED,
      entityType: ENTITY_TYPE,
      entityId: id,
      metadata: { userId: dto.userId, role: dto.role },
    });

    return member;
  }

  async removeMember(id: string, adminId: string, memberId: string) {
    const member = await this.prisma.communityMember.findFirst({ where: { id: memberId, communityId: id } });
    if (!member) throw new NotFoundException('Member not found');
    if (member.role === CommunityRole.OWNER) {
      throw new BadRequestException('The community owner cannot be removed');
    }

    await this.prisma.communityMember.delete({ where: { id: memberId } });
    await this.recalculateMemberCount(id);

    this.auditLogService.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: AuditAction.COMMUNITY_MEMBER_REMOVED,
      entityType: ENTITY_TYPE,
      entityId: id,
      metadata: { userId: member.userId },
    });

    return { success: true };
  }

  // ─── Events (mapping) ────────────────────────────────────────────────────────

  async addEvent(id: string, adminId: string, dto: AddCommunityEventDto) {
    await this.assertExists(id);

    const event = await this.prisma.event.findUnique({ where: { id: dto.eventId }, select: { id: true } });
    if (!event) throw new NotFoundException('Event not found');

    await this.prisma.communityEvent.upsert({
      where: { communityId_eventId: { communityId: id, eventId: dto.eventId } },
      create: { communityId: id, eventId: dto.eventId, source: CommunityEventSource.MANUAL, addedBy: adminId },
      // A previously auto-matched event becomes MANUAL (always-on) when added explicitly.
      update: { source: CommunityEventSource.MANUAL, addedBy: adminId },
    });

    await this.recalculateExperienceCount(id);
    this.logUpdate(id);
    return this.findOneForAdmin(id);
  }

  async removeEvent(id: string, eventId: string) {
    const link = await this.prisma.communityEvent.findUnique({
      where: { communityId_eventId: { communityId: id, eventId } },
    });
    if (!link) throw new NotFoundException('Event is not mapped to this community');

    await this.prisma.communityEvent.delete({
      where: { communityId_eventId: { communityId: id, eventId } },
    });
    await this.recalculateExperienceCount(id);
    this.logUpdate(id);
    return { success: true };
  }

  /**
   * Auto-match events to the community based on its cities + interests and attach
   * them as AUTO links. MANUAL links are never touched. Matching joins an event's
   * category to the community's interests via the InterestCategory mapping, since
   * events have no direct interest relation.
   */
  async resyncEvents(id: string) {
    const community = await this.prisma.community.findUnique({
      where: { id },
      select: {
        id: true,
        communityCities: true,
        interests: { select: { interestId: true } },
      },
    });
    if (!community) throw new NotFoundException('Community not found');

    if (!community.communityCities.length || !community.interests.length) {
      // Nothing to match on — clear any stale AUTO links and report.
      await this.prisma.communityEvent.deleteMany({
        where: { communityId: id, source: CommunityEventSource.AUTO },
      });
      await this.recalculateExperienceCount(id);
      return { matched: 0, attached: 0 };
    }

    const interestIds = community.interests.map((i) => i.interestId);
    const categoryRows = await this.prisma.interestCategory.findMany({
      where: { interestId: { in: interestIds } },
      select: { categoryId: true },
    });
    const categoryIds = [...new Set(categoryRows.map((r) => r.categoryId))];

    if (!categoryIds.length) {
      await this.prisma.communityEvent.deleteMany({
        where: { communityId: id, source: CommunityEventSource.AUTO },
      });
      await this.recalculateExperienceCount(id);
      return { matched: 0, attached: 0 };
    }

    const matches = await this.prisma.event.findMany({
      where: {
        status: EventStatus.PUBLISHED,
        city: { in: community.communityCities },
        categoryId: { in: categoryIds },
      },
      select: { id: true },
    });

    // Replace the AUTO set; MANUAL links already cover those event ids via the
    // unique constraint, so skipDuplicates leaves them untouched.
    const manual = await this.prisma.communityEvent.findMany({
      where: { communityId: id, source: CommunityEventSource.MANUAL },
      select: { eventId: true },
    });
    const manualIds = new Set(manual.map((m) => m.eventId));
    const autoIds = matches.map((m) => m.id).filter((eid) => !manualIds.has(eid));

    await this.prisma.$transaction([
      this.prisma.communityEvent.deleteMany({ where: { communityId: id, source: CommunityEventSource.AUTO } }),
      this.prisma.communityEvent.createMany({
        data: autoIds.map((eventId) => ({ communityId: id, eventId, source: CommunityEventSource.AUTO })),
        skipDuplicates: true,
      }),
    ]);

    await this.recalculateExperienceCount(id);
    return { matched: matches.length, attached: autoIds.length };
  }

  // ─── Publish ──────────────────────────────────────────────────────────────────

  async publish(id: string, adminId: string) {
    const community = await this.prisma.community.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        description: true,
        coverImageKey: true,
        iconKey: true,
        status: true,
        autoAddMatchingEvents: true,
        _count: { select: { members: true } },
      },
    });
    if (!community) throw new NotFoundException('Community not found');
    if (community.status === CommunityStatus.PUBLISHED) {
      throw new ConflictException('Community is already published');
    }

    const missing: string[] = [];
    if (!community.name) missing.push('name');
    if (!community.description) missing.push('description');
    if (!community.coverImageKey) missing.push('cover image');
    if (!community.iconKey) missing.push('icon');
    if (community._count.members < 1) missing.push('at least one role assignment');
    if (missing.length) {
      throw new BadRequestException(`Cannot publish — missing: ${missing.join(', ')}`);
    }

    if (community.autoAddMatchingEvents) {
      await this.resyncEvents(id);
    }

    await this.prisma.community.update({
      where: { id },
      data: { status: CommunityStatus.PUBLISHED, publishedAt: new Date() },
    });

    // Create the default General channel if it doesn't exist yet
    await this.prisma.communityChannel.upsert({
      where: { communityId_slug: { communityId: id, slug: 'general' } },
      create: {
        communityId: id,
        createdBy: adminId,
        name: 'General',
        slug: 'general',
        description: 'General discussion for everyone in the community.',
        isDefault: true,
        position: 0,
        welcomeTitle: `Welcome to ${community.name}!`,
        welcomeBody:
          'Introduce yourself, ask questions, and meet people attending upcoming experiences.',
        quickReplies: ['New Here', 'Going This Weekend', 'Looking For Suggestions'],
      },
      update: {},
    });

    this.auditLogService.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: AuditAction.COMMUNITY_PUBLISHED,
      entityType: ENTITY_TYPE,
      entityId: id,
    });

    return this.findOneForAdmin(id);
  }

  async archive(id: string, adminId: string) {
    const community = await this.prisma.community.findUnique({
      where: { id },
      select: { id: true, status: true, deletedAt: true },
    });
    if (!community || community.deletedAt) throw new NotFoundException('Community not found');
    if (community.status !== CommunityStatus.PUBLISHED) {
      throw new BadRequestException('Only PUBLISHED communities can be archived');
    }
    await this.prisma.community.update({ where: { id }, data: { status: CommunityStatus.ARCHIVED } });
    this.auditLogService.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: AuditAction.COMMUNITY_ARCHIVED,
      entityType: ENTITY_TYPE,
      entityId: id,
    });
    return { success: true };
  }

  async restore(id: string, adminId: string) {
    const community = await this.prisma.community.findUnique({
      where: { id },
      select: { id: true, status: true, deletedAt: true },
    });
    if (!community || community.deletedAt) throw new NotFoundException('Community not found');
    if (community.status !== CommunityStatus.ARCHIVED) {
      throw new BadRequestException('Only ARCHIVED communities can be restored');
    }
    await this.prisma.community.update({ where: { id }, data: { status: CommunityStatus.PUBLISHED } });
    this.auditLogService.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: AuditAction.COMMUNITY_RESTORED,
      entityType: ENTITY_TYPE,
      entityId: id,
    });
    return { success: true };
  }

  async softDelete(id: string, adminId: string) {
    const community = await this.prisma.community.findUnique({
      where: { id },
      select: { id: true, status: true, deletedAt: true },
    });
    if (!community || community.deletedAt) throw new NotFoundException('Community not found');
    if (community.status === CommunityStatus.PUBLISHED) {
      throw new BadRequestException('Archive the community before deleting it');
    }
    await this.prisma.community.update({ where: { id }, data: { deletedAt: new Date() } });
    this.auditLogService.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: AuditAction.COMMUNITY_DELETED,
      entityType: ENTITY_TYPE,
      entityId: id,
      metadata: { finalStatus: community.status },
    });
    return { success: true };
  }

  // ─── Reads ──────────────────────────────────────────────────────────────────

  async listForAdmin(query: ListCommunitiesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.CommunityWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.city) {
      where.OR = [{ primaryCity: query.city }, { communityCities: { has: query.city } }];
    }
    if (query.search) where.name = { contains: query.search, mode: 'insensitive' };

    const [data, total] = await Promise.all([
      this.prisma.community.findMany({
        where,
        select: {
          id: true,
          name: true,
          slug: true,
          type: true,
          status: true,
          primaryCity: true,
          memberCount: true,
          experienceCount: true,
          createdAt: true,
          publishedAt: true,
          category: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.community.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOneForAdmin(id: string) {
    const community = await this.prisma.community.findFirst({
      where: { id, deletedAt: null },
      include: COMMUNITY_DETAIL_INCLUDE,
    });
    if (!community) throw new NotFoundException('Community not found');
    return this.withSignedMedia(community);
  }

  // ─── Public / member-facing ────────────────────────────────────────────────

  async listPublic(query: ListCommunitiesQueryDto, firebaseUid?: string | null) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.CommunityWhereInput = {
      deletedAt: null,
      status: CommunityStatus.PUBLISHED,
      // INVITE_ONLY communities are not surfaced in public discovery.
      access: { not: CommunityAccess.INVITE_ONLY },
    };
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.city) {
      where.OR = [{ primaryCity: query.city }, { communityCities: { has: query.city } }];
    }
    if (query.search) where.name = { contains: query.search, mode: 'insensitive' };

    const [rows, total] = await Promise.all([
      this.prisma.community.findMany({
        where,
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          type: true,
          access: true,
          primaryCity: true,
          communityCities: true,
          coverImageKey: true,
          iconKey: true,
          memberCount: true,
          experienceCount: true,
          category: { select: { id: true, name: true } },
        },
        orderBy: { publishedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.community.count({ where }),
    ]);

    let memberSet = new Set<string>();
    let savedSet = new Set<string>();
    if (firebaseUid) {
      const user = await this.prisma.user.findUnique({ where: { firebaseUid }, select: { id: true } });
      if (user) {
        const ids = rows.map((r) => r.id);
        [memberSet, savedSet] = await Promise.all([
          this.getMembershipSet(user.id, ids),
          this.getSavedSet(user.id, ids),
        ]);
      }
    }

    const data = await Promise.all(
      rows.map(async (r) => ({ ...(await this.withSignedMedia(r)), isMember: memberSet.has(r.id), isSaved: savedSet.has(r.id) })),
    );
    return { data, total, page, limit };
  }

  /**
   * Recommend published communities ranked by interest overlap → city match → member count.
   *
   * Unauthenticated: accepts `interestIds` query params for stateless matching. No `cityMatch`
   * is returned (no profile city available). Already-joined communities are not excluded.
   *
   * Authenticated: reads stored LIKED/OPEN_TO affinities, excludes communities the caller
   * already belongs to, and appends `cityMatch` to each result.
   */
  async recommendForUser(firebaseUid: string | null, query: RecommendCommunitiesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    let interestIds: string[] = [];
    let userCity: string | null = null;
    let userId: string | null = null;

    if (firebaseUid) {
      const user = await this.prisma.user.findUnique({
        where: { firebaseUid },
        select: {
          id: true,
          attendeeProfile: { select: { city: true } },
          interestAffinities: {
            where: { affinity: { in: [InterestAffinity.LIKED, InterestAffinity.OPEN_TO] } },
            select: { interestId: true },
          },
        },
      });
      if (!user) throw new NotFoundException('User not found');
      userId = user.id;
      userCity = user.attendeeProfile?.city ?? null;
      interestIds = user.interestAffinities.map((a) => a.interestId);
    } else {
      interestIds = query.interestIds ?? [];
    }

    const userInterests = new Set(interestIds);

    const where: Prisma.CommunityWhereInput = {
      status: CommunityStatus.PUBLISHED,
      deletedAt: null,
      access: { not: CommunityAccess.INVITE_ONLY },
    };

    // Only filter to interest-matched communities when we have a signal to match on.
    if (interestIds.length) {
      where.interests = { some: { interestId: { in: interestIds } } };
    }

    // Exclude communities the authenticated user already belongs to.
    if (userId) {
      where.members = {
        none: {
          userId,
          status: { in: [CommunityMemberStatus.ACTIVE, CommunityMemberStatus.PENDING] },
        },
      };
    }

    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.city) {
      where.OR = [{ primaryCity: query.city }, { communityCities: { has: query.city } }];
    }
    if (query.search) where.name = { contains: query.search, mode: 'insensitive' };

    const candidates = await this.prisma.community.findMany({
      where,
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        type: true,
        access: true,
        primaryCity: true,
        communityCities: true,
        interestTags: true,
        coverImageKey: true,
        iconKey: true,
        memberCount: true,
        experienceCount: true,
        category: { select: { id: true, name: true } },
        interests: { select: { interestId: true } },
      },
    });

    const ranked = candidates
      .map((c) => {
        const { interests, communityCities, ...rest } = c;
        const overlap = interests.reduce((n, i) => (userInterests.has(i.interestId) ? n + 1 : n), 0);
        const cityMatch =
          !!userCity && (rest.primaryCity === userCity || communityCities.includes(userCity));
        return { rest, overlap, cityMatch };
      })
      .sort(
        (a, b) =>
          b.overlap - a.overlap ||
          Number(b.cityMatch) - Number(a.cityMatch) ||
          b.rest.memberCount - a.rest.memberCount,
      );

    const total = ranked.length;
    const pageSlice = ranked.slice((page - 1) * limit, (page - 1) * limit + limit);

    let savedSet = new Set<string>();
    if (userId) {
      savedSet = await this.getSavedSet(userId, pageSlice.map(({ rest }) => rest.id));
    }

    const data = await Promise.all(
      pageSlice.map(async ({ rest, overlap, cityMatch }) => {
        const base = { ...(await this.withSignedMedia(rest)), matchScore: overlap, isMember: false, isSaved: savedSet.has(rest.id) };
        // cityMatch is only meaningful (and only available) when the caller is authenticated.
        // isMember is always false here — already-joined communities are excluded from candidates.
        return firebaseUid ? { ...base, cityMatch } : base;
      }),
    );

    return { data, total, page, limit };
  }

  async findBySlug(slug: string, firebaseUid?: string | null) {
    const community = await this.prisma.community.findFirst({
      where: { slug, status: CommunityStatus.PUBLISHED, deletedAt: null },
      include: COMMUNITY_DETAIL_INCLUDE,
    });
    if (!community) throw new NotFoundException('Community not found');

    let isMember = false;
    let isSaved = false;
    if (firebaseUid) {
      const user = await this.prisma.user.findUnique({ where: { firebaseUid }, select: { id: true } });
      if (user) {
        const [membership, saved] = await Promise.all([
          this.prisma.communityMember.findUnique({
            where: { communityId_userId: { communityId: community.id, userId: user.id } },
            select: { status: true },
          }),
          this.prisma.savedCommunity.findUnique({
            where: { userId_communityId: { userId: user.id, communityId: community.id } },
            select: { id: true },
          }),
        ]);
        isMember =
          membership?.status === CommunityMemberStatus.ACTIVE ||
          membership?.status === CommunityMemberStatus.PENDING;
        isSaved = !!saved;
      }
    }

    return { ...(await this.withSignedMedia(community)), isMember, isSaved };
  }

  async getEvents(slug: string, query: { upcoming?: boolean; page?: number; limit?: number }) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const community = await this.prisma.community.findFirst({
      where: { slug, status: CommunityStatus.PUBLISHED, deletedAt: null },
      select: { id: true },
    });
    if (!community) throw new NotFoundException('Community not found');

    const now = new Date();
    const links = await this.prisma.communityEvent.findMany({
      where: {
        communityId: community.id,
        ...(query.upcoming
          ? { event: { status: EventStatus.PUBLISHED, eventDate: { gte: now } } }
          : {}),
      },
      select: {
        source: true,
        event: {
          select: {
            id: true,
            title: true,
            eventDate: true,
            startTime: true,
            endTime: true,
            city: true,
            venueName: true,
            fullAddress: true,
            isFree: true,
            status: true,
            eventType: true,
            tags: true,
            media: { where: { type: 'COVER' }, select: { url: true }, take: 1 },
            tickets: { select: { price: true, soldCount: true, totalCapacity: true } },
            hostProfile: {
              select: {
                id: true,
                displayName: true,
                user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
              },
            },
          },
        },
      },
    });

    links.sort((a, b) => (a.event.eventDate?.getTime() ?? 0) - (b.event.eventDate?.getTime() ?? 0));

    const total = links.length;
    const pageLinks = links.slice((page - 1) * limit, (page - 1) * limit + limit);

    const data = await Promise.all(
      pageLinks.map(async ({ source, event }) => {
        const cover = event.media[0] ?? null;
        const coverImageUrl = cover
          ? await this.storageService.getPresignedDownloadUrl(cover.url)
          : null;

        const hostAvatarUrl =
          event.hostProfile?.user?.avatarUrl
            ? await this.storageService.getPresignedDownloadUrl(event.hostProfile.user.avatarUrl)
            : null;

        const attendeeCount = event.tickets.reduce((n, t) => n + t.soldCount, 0);
        const paidTickets = event.tickets.filter((t) => Number(t.price) > 0);
        const minPrice =
          !event.isFree && paidTickets.length
            ? Math.min(...paidTickets.map((t) => Number(t.price)))
            : null;

        return {
          id: event.id,
          title: event.title,
          eventDate: event.eventDate,
          startTime: event.startTime,
          endTime: event.endTime,
          city: event.city,
          venueName: event.venueName,
          fullAddress: event.fullAddress,
          isFree: event.isFree,
          minPrice,
          attendeeCount,
          status: event.status,
          eventType: event.eventType,
          tags: event.tags,
          coverImageUrl,
          source,
          host: event.hostProfile
            ? {
                id: event.hostProfile.id,
                displayName: event.hostProfile.displayName,
                userId: event.hostProfile.user?.id ?? null,
                firstName: event.hostProfile.user?.firstName ?? null,
                lastName: event.hostProfile.user?.lastName ?? null,
                avatarUrl: hostAvatarUrl,
              }
            : null,
        };
      }),
    );

    return { data, total, page, limit };
  }

  async getHosts(slug: string) {
    const community = await this.prisma.community.findFirst({
      where: { slug, status: CommunityStatus.PUBLISHED, deletedAt: null },
      select: { id: true },
    });
    if (!community) throw new NotFoundException('Community not found');

    const hostMembers = await this.prisma.communityMember.findMany({
      where: { communityId: community.id, role: CommunityRole.HOST, status: CommunityMemberStatus.ACTIVE },
      select: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
            hostProfile: { select: { id: true, displayName: true } },
          },
        },
      },
    });

    const withCounts = await Promise.all(
      hostMembers.map(async ({ user }) => {
        const eventCount = await this.prisma.communityEvent.count({
          where: { communityId: community.id, event: { hostProfile: { userId: user.id } } },
        });
        const avatarUrl = user.avatarUrl
          ? await this.storageService.getPresignedDownloadUrl(user.avatarUrl)
          : null;
        return {
          userId: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          avatarUrl,
          displayName: user.hostProfile?.displayName ?? null,
          eventCount,
        };
      }),
    );

    return withCounts.sort((a, b) => b.eventCount - a.eventCount);
  }

  async getStats(slug: string) {
    const community = await this.prisma.community.findFirst({
      where: { slug, status: CommunityStatus.PUBLISHED, deletedAt: null },
      select: { id: true, memberCount: true, experienceCount: true },
    });
    if (!community) throw new NotFoundException('Community not found');

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [pendingCount, newMembersThisWeek, hostCount] = await Promise.all([
      this.prisma.communityMember.count({
        where: { communityId: community.id, status: CommunityMemberStatus.PENDING },
      }),
      this.prisma.communityMember.count({
        where: { communityId: community.id, status: CommunityMemberStatus.ACTIVE, joinedAt: { gte: sevenDaysAgo } },
      }),
      this.prisma.communityMember.count({
        where: { communityId: community.id, role: CommunityRole.HOST, status: CommunityMemberStatus.ACTIVE },
      }),
    ]);

    return {
      memberCount: community.memberCount,
      experienceCount: community.experienceCount,
      pendingCount,
      newMembersThisWeek,
      hostCount,
    };
  }

  async join(id: string, firebaseUid: string, dto: JoinCommunityDto, ip?: string, userAgent?: string) {
    if (!dto.guidelinesAccepted) {
      throw new BadRequestException('You must accept the community guidelines to join');
    }

    const user = await this.prisma.user.findUnique({ where: { firebaseUid }, select: { id: true } });
    if (!user) throw new NotFoundException('User not found');
    const userId = user.id;

    const community = await this.prisma.community.findFirst({
      where: { id, status: CommunityStatus.PUBLISHED, deletedAt: null },
      select: { id: true, access: true },
    });
    if (!community) throw new NotFoundException('Community not found');

    if (community.access === CommunityAccess.INVITE_ONLY) {
      throw new BadRequestException('This community is invite only');
    }

    const existing = await this.prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId: id, userId } },
    });
    if (existing && existing.status !== CommunityMemberStatus.LEFT) {
      throw new ConflictException('You are already a member or have a pending request');
    }

    const status =
      community.access === CommunityAccess.APPROVAL_REQUIRED
        ? CommunityMemberStatus.PENDING
        : CommunityMemberStatus.ACTIVE;

    const now = new Date();
    const member = await this.prisma.communityMember.upsert({
      where: { communityId_userId: { communityId: id, userId } },
      create: {
        communityId: id,
        userId,
        role: CommunityRole.MEMBER,
        status,
        joinedAt: status === CommunityMemberStatus.ACTIVE ? now : null,
        lastActivityAt: status === CommunityMemberStatus.ACTIVE ? now : null,
        profileVisibility: dto.profileVisibility,
        guidelinesAcceptedAt: now,
      },
      update: {
        status,
        joinedAt: status === CommunityMemberStatus.ACTIVE ? now : null,
        lastActivityAt: status === CommunityMemberStatus.ACTIVE ? now : null,
        profileVisibility: dto.profileVisibility,
        guidelinesAcceptedAt: now,
      },
    });

    if (status === CommunityMemberStatus.ACTIVE) await this.recalculateMemberCount(id);

    await this.consentService.grantConsent({
      userId,
      consentType: ConsentType.COMMUNITY_GUIDELINES,
      ipAddress: ip,
      userAgent,
    });

    // Fetch after memberCount recalculation so the count is current.
    const communityDetail = await this.prisma.community.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        memberCount: true,
        experienceCount: true,
        primaryCity: true,
        iconKey: true,
      },
    });

    const iconUrl = communityDetail?.iconKey
      ? await this.storageService.getPresignedDownloadUrl(communityDetail.iconKey)
      : null;

    return {
      status: member.status,
      profileVisibility: member.profileVisibility,
      community: {
        id: communityDetail!.id,
        name: communityDetail!.name,
        slug: communityDetail!.slug,
        memberCount: communityDetail!.memberCount,
        experienceCount: communityDetail!.experienceCount,
        primaryCity: communityDetail!.primaryCity,
        iconUrl,
      },
    };
  }

  async leave(id: string, firebaseUid: string) {
    const user = await this.prisma.user.findUnique({ where: { firebaseUid }, select: { id: true } });
    if (!user) throw new NotFoundException('User not found');

    const community = await this.prisma.community.findFirst({
      where: { id, status: CommunityStatus.PUBLISHED, deletedAt: null },
      select: { id: true },
    });
    if (!community) throw new NotFoundException('Community not found');

    const member = await this.prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId: id, userId: user.id } },
    });
    if (!member || member.status === CommunityMemberStatus.LEFT) {
      throw new NotFoundException('You are not a member of this community');
    }
    if (member.role === CommunityRole.OWNER) {
      throw new BadRequestException('The community owner cannot leave; transfer ownership first');
    }

    const wasActive = member.status === CommunityMemberStatus.ACTIVE;

    await this.prisma.communityMember.update({
      where: { communityId_userId: { communityId: id, userId: user.id } },
      data: { status: CommunityMemberStatus.LEFT },
    });

    if (wasActive) await this.recalculateMemberCount(id);

    return { success: true };
  }

  async listMembers(id: string, page: number, limit: number) {
    const community = await this.prisma.community.findFirst({
      where: { id, status: CommunityStatus.PUBLISHED, deletedAt: null },
      select: { id: true, memberVisibility: true },
    });
    if (!community) throw new NotFoundException('Community not found');

    if (community.memberVisibility === MemberVisibility.HIDDEN) {
      return { data: [], total: 0, page, limit };
    }

    const where = { communityId: id, status: CommunityMemberStatus.ACTIVE };

    const [rows, total] = await Promise.all([
      this.prisma.communityMember.findMany({
        where,
        select: {
          role: true,
          joinedAt: true,
          user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        },
        orderBy: { joinedAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.communityMember.count({ where }),
    ]);

    const data = await Promise.all(
      rows.map(async (m) => ({
        userId: m.user.id,
        firstName: m.user.firstName,
        lastName: m.user.lastName,
        avatarUrl: m.user.avatarUrl
          ? await this.storageService.getPresignedDownloadUrl(m.user.avatarUrl)
          : null,
        role: m.role,
        joinedAt: m.joinedAt,
      })),
    );

    return { data, total, page, limit };
  }

  // ─── Host-facing browse ───────────────────────────────────────────────────────

  async listForHost(userId: string, query: ListHostCommunitiesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    // Resolve host's interest IDs from declared experience categories + published event categories.
    const hostProfile = await this.prisma.hostProfile.findUnique({
      where: { userId },
      select: {
        categories: { select: { categoryId: true } },
        events: {
          where: { status: EventStatus.PUBLISHED, categoryId: { not: null } },
          select: { categoryId: true },
        },
      },
    });

    let hostInterestIds = new Set<string>();
    if (hostProfile) {
      const categoryIds = new Set<string>([
        ...hostProfile.categories.map((c) => c.categoryId),
        ...hostProfile.events.map((e) => e.categoryId).filter((id): id is string => id !== null),
      ]);
      if (categoryIds.size > 0) {
        const interestMappings = await this.prisma.interestCategory.findMany({
          where: { categoryId: { in: [...categoryIds] } },
          select: { interestId: true },
        });
        hostInterestIds = new Set(interestMappings.map((m) => m.interestId));
      }
    }

    const where: Prisma.CommunityWhereInput = {
      status: CommunityStatus.PUBLISHED,
      deletedAt: null,
    };

    if (query.search) where.name = { contains: query.search, mode: 'insensitive' };
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.city) {
      where.OR = [{ primaryCity: query.city }, { communityCities: { has: query.city } }];
    }

    if (query.audienceSize) {
      const rangeMap: Record<AudienceSize, Prisma.IntFilter> = {
        [AudienceSize.SMALL]: { lt: 100 },
        [AudienceSize.MEDIUM]: { gte: 100, lt: 500 },
        [AudienceSize.LARGE]: { gte: 500, lt: 2000 },
        [AudienceSize.VERY_LARGE]: { gte: 2000 },
      };
      where.memberCount = rangeMap[query.audienceSize];
    }

    const tab = query.tab ?? HostCommunityTab.ALL;
    if (tab === HostCommunityTab.PUBLIC) {
      where.access = CommunityAccess.PUBLIC;
    } else if (tab === HostCommunityTab.APPROVAL_REQUIRED) {
      where.access = CommunityAccess.APPROVAL_REQUIRED;
    } else if (tab === HostCommunityTab.INVITE_ONLY) {
      where.access = CommunityAccess.INVITE_ONLY;
    } else {
      // ALL and MY_COMMUNITIES tabs: apply the standalone access dropdown filter if present.
      if (query.access) where.access = query.access;
      if (tab === HostCommunityTab.MY_COMMUNITIES) {
        where.members = {
          some: {
            userId,
            status: { in: [CommunityMemberStatus.ACTIVE, CommunityMemberStatus.PENDING] },
          },
        };
      }
    }

    const [rows, total] = await Promise.all([
      this.prisma.community.findMany({
        where,
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          type: true,
          access: true,
          primaryCity: true,
          communityCities: true,
          coverImageKey: true,
          iconKey: true,
          memberCount: true,
          experienceCount: true,
          category: { select: { id: true, name: true } },
          interests: { select: { interestId: true } },
        },
        orderBy: { publishedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.community.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);
    if (!rows.length) return { data: [], total, page, limit, totalPages };

    const communityIds = rows.map((r) => r.id);

    // Batch: membership status per community.
    const membershipRows = await this.prisma.communityMember.findMany({
      where: {
        userId,
        communityId: { in: communityIds },
        status: { in: [CommunityMemberStatus.ACTIVE, CommunityMemberStatus.PENDING] },
      },
      select: { communityId: true, status: true },
    });
    const membershipMap = new Map(membershipRows.map((r) => [r.communityId, r.status]));

    // Batch: experiences this calendar month per community.
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const communityEventRows = await this.prisma.communityEvent.findMany({
      where: {
        communityId: { in: communityIds },
        event: { eventDate: { gte: monthStart, lt: monthEnd } },
      },
      select: { communityId: true },
    });
    const experiencesThisMonthMap = new Map<string, number>();
    for (const row of communityEventRows) {
      experiencesThisMonthMap.set(row.communityId, (experiencesThisMonthMap.get(row.communityId) ?? 0) + 1);
    }

    // Batch: average host rating per community (from EventReview.hostRating on community-linked events).
    const communityIdSet = new Set(communityIds);
    const reviewRows = await this.prisma.eventReview.findMany({
      where: {
        hostRating: { not: null },
        event: { communities: { some: { communityId: { in: communityIds } } } },
      },
      select: {
        hostRating: true,
        event: {
          select: {
            communities: {
              where: { communityId: { in: communityIds } },
              select: { communityId: true },
            },
          },
        },
      },
    });

    const ratingAccum = new Map<string, { sum: number; count: number }>();
    for (const review of reviewRows) {
      for (const ce of review.event.communities) {
        if (communityIdSet.has(ce.communityId)) {
          const acc = ratingAccum.get(ce.communityId) ?? { sum: 0, count: 0 };
          acc.sum += review.hostRating!;
          acc.count += 1;
          ratingAccum.set(ce.communityId, acc);
        }
      }
    }
    const avgHostRatingMap = new Map<string, number | null>();
    for (const [cid, { sum, count }] of ratingAccum) {
      avgHostRatingMap.set(cid, count > 0 ? Math.round((sum / count) * 10) / 10 : null);
    }

    const data = await Promise.all(
      rows.map(async (r) => {
        const { interests, ...rest } = r;
        const communityInterestIds = interests.map((i) => i.interestId);
        let matchScore: number | null = null;
        let matchLabel: string | null = null;
        if (communityInterestIds.length > 0) {
          const overlap = communityInterestIds.filter((id) => hostInterestIds.has(id)).length;
          matchScore = Math.round((overlap / communityInterestIds.length) * 100);
          if (matchScore >= 90) matchLabel = 'Great match!';
          else if (matchScore >= 75) matchLabel = 'High engagement';
        }

        const memberStatus = membershipMap.get(r.id);
        const signed = await this.withSignedMedia(rest);
        return {
          ...signed,
          isVerified: rest.type === CommunityType.MEETDAY_MANAGED_PUBLIC,
          experiencesThisMonth: experiencesThisMonthMap.get(r.id) ?? 0,
          avgHostRating: avgHostRatingMap.get(r.id) ?? null,
          matchScore,
          matchLabel,
          isMember: memberStatus === CommunityMemberStatus.ACTIVE,
          isPending: memberStatus === CommunityMemberStatus.PENDING,
        };
      }),
    );

    return { data, total, page, limit, totalPages };
  }

  async getHostActivity(userId: string) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [communitiesJoined, accessRequests, pendingReviews, experienceGroups, totalCommunityViews] =
      await Promise.all([
        this.prisma.communityMember.count({ where: { userId, status: CommunityMemberStatus.ACTIVE } }),
        this.prisma.communityMember.count({ where: { userId, status: CommunityMemberStatus.PENDING } }),
        this.prisma.eventReview.count({
          where: {
            createdAt: { gte: thirtyDaysAgo },
            event: {
              hostProfile: { userId },
              communities: { some: {} },
            },
          },
        }),
        this.prisma.communityEvent.groupBy({
          by: ['eventId'],
          where: { event: { hostProfile: { userId } } },
        }),
        this.prisma.order.count({
          where: {
            status: OrderStatus.CONFIRMED,
            event: {
              hostProfile: { userId },
              communities: { some: {} },
            },
          },
        }),
      ]);

    return {
      communitiesJoined,
      accessRequests,
      pendingReviews,
      experiencesInCommunities: experienceGroups.length,
      totalCommunityViews,
    };
  }

  // ─── Host community overview ───────────────────────────────────────────────────

  async getHostCommunityOverview(communityId: string, userId: string) {
    const community = await this.prisma.community.findFirst({
      where: { id: communityId, status: CommunityStatus.PUBLISHED, deletedAt: null },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        type: true,
        access: true,
        primaryCity: true,
        communityCities: true,
        coverImageKey: true,
        iconKey: true,
        memberCount: true,
        experienceCount: true,
        category: { select: { id: true, name: true } },
        interests: {
          select: {
            interestId: true,
            interest: { select: { id: true, name: true, slug: true } },
          },
        },
      },
    });
    if (!community) throw new NotFoundException('Community not found');

    // Resolve host interest IDs from declared experience categories + published event categories.
    const hostProfile = await this.prisma.hostProfile.findUnique({
      where: { userId },
      select: {
        categories: { select: { categoryId: true } },
        events: {
          where: { status: EventStatus.PUBLISHED, categoryId: { not: null } },
          select: { categoryId: true },
        },
      },
    });

    let hostInterestIds = new Set<string>();
    if (hostProfile) {
      const categoryIds = new Set<string>([
        ...hostProfile.categories.map((c) => c.categoryId),
        ...hostProfile.events.map((e) => e.categoryId).filter((id): id is string => id !== null),
      ]);
      if (categoryIds.size > 0) {
        const interestMappings = await this.prisma.interestCategory.findMany({
          where: { categoryId: { in: [...categoryIds] } },
          select: { interestId: true },
        });
        hostInterestIds = new Set(interestMappings.map((m) => m.interestId));
      }
    }

    const communityInterestIds = community.interests.map((i) => i.interestId);
    let matchScore: number | null = null;
    let matchLabel: string | null = null;
    let matchDescription: string | null = null;
    if (communityInterestIds.length > 0) {
      const overlap = communityInterestIds.filter((id) => hostInterestIds.has(id)).length;
      matchScore = Math.round((overlap / communityInterestIds.length) * 100);
      if (matchScore >= 90) {
        matchLabel = 'Great match!';
        matchDescription = 'Your audience aligns well with this community.';
      } else if (matchScore >= 75) {
        matchLabel = 'High engagement';
        matchDescription = 'This community has a highly engaged audience for your content type.';
      }
    }

    const memberRecord = await this.prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId, userId } },
      select: { status: true, role: true },
    });
    const isMember = memberRecord?.status === CommunityMemberStatus.ACTIVE;
    const isPending = memberRecord?.status === CommunityMemberStatus.PENDING;

    const now = new Date();
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [memberUserRows, thisMonthCount, lastMonthCount, monthlyActiveCount, totalViews] = await Promise.all([
      this.prisma.communityMember.findMany({
        where: { communityId, status: CommunityMemberStatus.ACTIVE },
        select: { userId: true },
      }),
      this.prisma.communityMember.count({
        where: { communityId, status: CommunityMemberStatus.ACTIVE, joinedAt: { gte: startOfThisMonth } },
      }),
      this.prisma.communityMember.count({
        where: { communityId, status: CommunityMemberStatus.ACTIVE, joinedAt: { gte: startOfLastMonth, lt: startOfThisMonth } },
      }),
      this.prisma.communityMember.count({
        where: { communityId, status: CommunityMemberStatus.ACTIVE, lastActivityAt: { gte: thirtyDaysAgo } },
      }),
      this.prisma.order.count({
        where: { status: OrderStatus.CONFIRMED, event: { communities: { some: { communityId } } } },
      }),
    ]);

    const activeUserIds = memberUserRows.map((m) => m.userId);
    const profiles =
      activeUserIds.length > 0
        ? await this.prisma.attendeeProfile.findMany({
            where: { userId: { in: activeUserIds } },
            select: { ageRange: true, gender: true, city: true },
          })
        : [];

    // Age stats — find the modal age range.
    const ageCounts = new Map<string, number>();
    for (const p of profiles) {
      if (p.ageRange) ageCounts.set(p.ageRange, (ageCounts.get(p.ageRange) ?? 0) + 1);
    }
    let topAgeGroup: { label: string; pct: number } | null = null;
    if (ageCounts.size > 0) {
      const [topRange, topCount] = [...ageCounts.entries()].sort((a, b) => b[1] - a[1])[0];
      topAgeGroup = {
        label: this.ageRangeLabel(topRange),
        pct: Math.round((topCount / profiles.length) * 100),
      };
    }

    // Gender stats — percentages computed over MALE + FEMALE + NON_BINARY only (excluding PREFER_NOT_TO_SAY).
    const genderCounts = { MALE: 0, FEMALE: 0, NON_BINARY: 0 };
    let hasGenderData = false;
    for (const p of profiles) {
      if (p.gender && p.gender !== 'PREFER_NOT_TO_SAY') {
        hasGenderData = true;
        if (p.gender === 'MALE') genderCounts.MALE += 1;
        else if (p.gender === 'FEMALE') genderCounts.FEMALE += 1;
        else if (p.gender === 'NON_BINARY') genderCounts.NON_BINARY += 1;
      } else if (p.gender === 'PREFER_NOT_TO_SAY') {
        hasGenderData = true;
      }
    }
    const genderTotal = genderCounts.MALE + genderCounts.FEMALE + genderCounts.NON_BINARY;
    const genderSplit =
      hasGenderData && genderTotal > 0
        ? {
            male: genderCounts.MALE,
            female: genderCounts.FEMALE,
            nonBinary: genderCounts.NON_BINARY,
            malePct: Math.round((genderCounts.MALE / genderTotal) * 100),
            femalePct: Math.round((genderCounts.FEMALE / genderTotal) * 100),
            nonBinaryPct: Math.round((genderCounts.NON_BINARY / genderTotal) * 100),
          }
        : null;

    // City stats — top 10 cities by member count.
    const cityCounts = new Map<string, number>();
    for (const p of profiles) {
      if (p.city) cityCounts.set(p.city, (cityCounts.get(p.city) ?? 0) + 1);
    }
    const sortedCities = [...cityCounts.entries()].sort((a, b) => b[1] - a[1]);
    const topCities = sortedCities.slice(0, 10).map(([city]) => city);

    const memberGrowthPct =
      lastMonthCount > 0 || thisMonthCount > 0
        ? Math.round(((thisMonthCount - lastMonthCount) / Math.max(lastMonthCount, 1)) * 1000) / 10
        : null;

    const avgEngagementRate =
      community.memberCount > 0
        ? Math.round((monthlyActiveCount / community.memberCount) * 1000) / 10
        : null;

    const upcomingLinks = await this.prisma.communityEvent.findMany({
      where: {
        communityId,
        event: { status: EventStatus.PUBLISHED, eventDate: { gte: now } },
      },
      select: {
        event: {
          select: {
            id: true,
            title: true,
            eventDate: true,
            startTime: true,
            city: true,
            media: { where: { type: 'COVER' }, select: { url: true }, take: 1 },
            tickets: { select: { soldCount: true } },
          },
        },
      },
      take: 4,
    });

    upcomingLinks.sort((a, b) => (a.event.eventDate?.getTime() ?? 0) - (b.event.eventDate?.getTime() ?? 0));

    const upcomingExperiences = await Promise.all(
      upcomingLinks.map(async ({ event }) => {
        const cover = event.media[0] ?? null;
        const coverImageUrl = cover ? await this.storageService.getPresignedDownloadUrl(cover.url) : null;
        const interestedCount = event.tickets.reduce((n, t) => n + t.soldCount, 0);
        return {
          id: event.id,
          title: event.title,
          eventDate: event.eventDate,
          startTime: event.startTime,
          city: event.city,
          coverImageUrl,
          interestedCount,
        };
      }),
    );

    const signed = await this.withSignedMedia({ coverImageKey: community.coverImageKey, iconKey: community.iconKey });

    return {
      community: {
        id: community.id,
        slug: community.slug,
        name: community.name,
        description: community.description,
        type: community.type,
        access: community.access,
        isVerified: community.type === CommunityType.MEETDAY_MANAGED_PUBLIC,
        primaryCity: community.primaryCity,
        communityCities: community.communityCities,
        coverImageUrl: signed.coverImageUrl,
        iconUrl: signed.iconUrl,
        interestTags: community.interests.map((i) => i.interest),
        category: community.category,
      },
      audience: {
        matchScore,
        matchLabel,
        matchDescription,
        memberCount: community.memberCount,
        memberGrowthPct,
        topAgeGroup,
        genderSplit,
        topCities,
        cityCount: cityCounts.size,
      },
      hostContext: {
        isMember,
        isPending,
        role: memberRecord?.role ?? null,
        permissions: {
          canSubmitExperiences: isMember,
          canReplyToComments: isMember,
          canViewAnalytics: isMember,
          canReceiveUpdates: isMember || isPending,
        },
      },
      stats: {
        totalViews,
        experiencesPublished: community.experienceCount,
        monthlyActiveMembers: monthlyActiveCount,
        avgEngagementRate,
      },
      upcomingExperiences,
    };
  }

  async getHostCommunityAudience(communityId: string, userId: string) {
    const community = await this.prisma.community.findFirst({
      where: { id: communityId, status: CommunityStatus.PUBLISHED, deletedAt: null },
      select: {
        id: true,
        memberCount: true,
        interests: {
          select: {
            interestId: true,
            interest: { select: { id: true, name: true, slug: true } },
          },
        },
      },
    });
    if (!community) throw new NotFoundException('Community not found');

    const now = new Date();
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      thisMonthNewMembers,
      lastMonthNewMembers,
      thisMonthActive,
      lastMonthActive,
      monthlyActive30d,
      overallRatingAgg,
      thisMonthRatingAgg,
      lastMonthRatingAgg,
      totalViews,
      thisMonthViews,
      lastMonthViews,
      totalComments,
      thisMonthComments,
      lastMonthComments,
      totalShares,
      thisMonthShares,
      lastMonthShares,
      memberUserRows,
    ] = await Promise.all([
      this.prisma.communityMember.count({
        where: { communityId, status: CommunityMemberStatus.ACTIVE, joinedAt: { gte: startOfThisMonth } },
      }),
      this.prisma.communityMember.count({
        where: { communityId, status: CommunityMemberStatus.ACTIVE, joinedAt: { gte: startOfLastMonth, lt: startOfThisMonth } },
      }),
      this.prisma.communityMember.count({
        where: { communityId, status: CommunityMemberStatus.ACTIVE, lastActivityAt: { gte: startOfThisMonth } },
      }),
      this.prisma.communityMember.count({
        where: { communityId, status: CommunityMemberStatus.ACTIVE, lastActivityAt: { gte: startOfLastMonth, lt: startOfThisMonth } },
      }),
      this.prisma.communityMember.count({
        where: { communityId, status: CommunityMemberStatus.ACTIVE, lastActivityAt: { gte: thirtyDaysAgo } },
      }),
      this.prisma.eventReview.aggregate({
        _avg: { hostRating: true },
        where: { hostRating: { not: null }, event: { communities: { some: { communityId } } } },
      }),
      this.prisma.eventReview.aggregate({
        _avg: { hostRating: true },
        where: {
          hostRating: { not: null },
          createdAt: { gte: startOfThisMonth },
          event: { communities: { some: { communityId } } },
        },
      }),
      this.prisma.eventReview.aggregate({
        _avg: { hostRating: true },
        where: {
          hostRating: { not: null },
          createdAt: { gte: startOfLastMonth, lt: startOfThisMonth },
          event: { communities: { some: { communityId } } },
        },
      }),
      this.prisma.communityPostView.count({ where: { post: { communityId } } }),
      this.prisma.communityPostView.count({ where: { post: { communityId }, viewedAt: { gte: startOfThisMonth } } }),
      this.prisma.communityPostView.count({ where: { post: { communityId }, viewedAt: { gte: startOfLastMonth, lt: startOfThisMonth } } }),
      this.prisma.communityPostComment.count({ where: { post: { communityId } } }),
      this.prisma.communityPostComment.count({ where: { post: { communityId }, createdAt: { gte: startOfThisMonth } } }),
      this.prisma.communityPostComment.count({ where: { post: { communityId }, createdAt: { gte: startOfLastMonth, lt: startOfThisMonth } } }),
      this.prisma.communityPostShare.count({ where: { post: { communityId } } }),
      this.prisma.communityPostShare.count({ where: { post: { communityId }, createdAt: { gte: startOfThisMonth } } }),
      this.prisma.communityPostShare.count({ where: { post: { communityId }, createdAt: { gte: startOfLastMonth, lt: startOfThisMonth } } }),
      this.prisma.communityMember.findMany({
        where: { communityId, status: CommunityMemberStatus.ACTIVE },
        select: { userId: true },
      }),
    ]);

    const activeUserIds = memberUserRows.map((m) => m.userId);
    const profiles =
      activeUserIds.length > 0
        ? await this.prisma.attendeeProfile.findMany({
            where: { userId: { in: activeUserIds } },
            select: { ageRange: true, gender: true, city: true },
          })
        : [];

    // Age distribution — all 6 buckets in canonical order (0-count buckets included).
    const AGE_RANGE_ORDER = ['UNDER_18', 'AGE_18_24', 'AGE_25_34', 'AGE_35_44', 'AGE_45_54', 'AGE_55_PLUS'];
    const ageCounts = new Map<string, number>();
    for (const p of profiles) {
      if (p.ageRange) ageCounts.set(p.ageRange, (ageCounts.get(p.ageRange) ?? 0) + 1);
    }
    const profilesWithAge = profiles.filter((p) => p.ageRange).length;
    const ageDistribution = AGE_RANGE_ORDER.map((range) => {
      const count = ageCounts.get(range) ?? 0;
      return {
        range,
        label: this.ageRangeLabel(range),
        count,
        pct: profilesWithAge > 0 ? Math.round((count / profilesWithAge) * 1000) / 10 : 0,
      };
    });

    // Gender split
    const genderCounts = { MALE: 0, FEMALE: 0, NON_BINARY: 0 };
    let hasGenderData = false;
    for (const p of profiles) {
      if (p.gender && p.gender !== 'PREFER_NOT_TO_SAY') {
        hasGenderData = true;
        if (p.gender === 'MALE') genderCounts.MALE += 1;
        else if (p.gender === 'FEMALE') genderCounts.FEMALE += 1;
        else if (p.gender === 'NON_BINARY') genderCounts.NON_BINARY += 1;
      } else if (p.gender === 'PREFER_NOT_TO_SAY') {
        hasGenderData = true;
      }
    }
    const genderTotal = genderCounts.MALE + genderCounts.FEMALE + genderCounts.NON_BINARY;
    const genderSplit =
      hasGenderData && genderTotal > 0
        ? {
            male: genderCounts.MALE,
            female: genderCounts.FEMALE,
            nonBinary: genderCounts.NON_BINARY,
            malePct: Math.round((genderCounts.MALE / genderTotal) * 100),
            femalePct: Math.round((genderCounts.FEMALE / genderTotal) * 100),
            nonBinaryPct: Math.round((genderCounts.NON_BINARY / genderTotal) * 100),
          }
        : null;

    // Top cities with percentages.
    const cityCounts = new Map<string, number>();
    for (const p of profiles) {
      if (p.city) cityCounts.set(p.city, (cityCounts.get(p.city) ?? 0) + 1);
    }
    const profilesWithCity = profiles.filter((p) => p.city).length;
    const topCities = [...cityCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([city, count]) => ({
        city,
        count,
        pct: profilesWithCity > 0 ? Math.round((count / profilesWithCity) * 1000) / 10 : 0,
      }));

    // Audience interests — single batch query across all community interests.
    const communityInterestIds = community.interests.map((i) => i.interestId);
    let interests: Array<{ id: string; name: string; slug: string; memberPct: number }> = [];
    if (communityInterestIds.length > 0 && activeUserIds.length > 0) {
      const affinityRows = await this.prisma.userInterestAffinity.findMany({
        where: {
          interestId: { in: communityInterestIds },
          affinity: { in: [InterestAffinity.LIKED, InterestAffinity.OPEN_TO] },
          userId: { in: activeUserIds },
        },
        select: { interestId: true },
      });
      const affinityCountMap = new Map<string, number>();
      for (const row of affinityRows) {
        affinityCountMap.set(row.interestId, (affinityCountMap.get(row.interestId) ?? 0) + 1);
      }
      const interestLookup = new Map(community.interests.map((i) => [i.interestId, i.interest]));
      interests = communityInterestIds
        .map((interestId) => {
          const interest = interestLookup.get(interestId)!;
          const count = affinityCountMap.get(interestId) ?? 0;
          return {
            id: interest.id,
            name: interest.name,
            slug: interest.slug,
            memberPct: Math.round((count / activeUserIds.length) * 1000) / 10,
          };
        })
        .sort((a, b) => b.memberPct - a.memberPct);
    }

    // Derived stats.
    const memberCount = community.memberCount;
    const prevMonthMemberCount = memberCount - thisMonthNewMembers;
    const totalMemberGrowthPct =
      prevMonthMemberCount > 0
        ? Math.round((thisMonthNewMembers / prevMonthMemberCount) * 1000) / 10
        : null;
    const newMemberGrowthPct =
      lastMonthNewMembers > 0
        ? Math.round(((thisMonthNewMembers - lastMonthNewMembers) / lastMonthNewMembers) * 1000) / 10
        : null;
    const engagementRate =
      memberCount > 0 ? Math.round((monthlyActive30d / memberCount) * 1000) / 10 : null;
    const lastMonthEngagementRate =
      memberCount > 0 ? Math.round((lastMonthActive / memberCount) * 1000) / 10 : null;
    const engagementRateDelta =
      engagementRate != null && lastMonthEngagementRate != null
        ? Math.round((engagementRate - lastMonthEngagementRate) * 10) / 10
        : null;
    const avgExperienceRating =
      overallRatingAgg._avg.hostRating != null
        ? Math.round(overallRatingAgg._avg.hostRating * 10) / 10
        : null;
    const avgExperienceRatingDelta =
      thisMonthRatingAgg._avg.hostRating != null && lastMonthRatingAgg._avg.hostRating != null
        ? Math.round((thisMonthRatingAgg._avg.hostRating - lastMonthRatingAgg._avg.hostRating) * 10) / 10
        : null;

    const growthPct = (current: number, previous: number): number | null =>
      previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null;

    // Audience highlights — computed from thresholds.
    const highlights: string[] = [];
    if (engagementRate != null && engagementRate >= 70) highlights.push('Highly active audience');
    const youngCount = (ageCounts.get('AGE_18_24') ?? 0) + (ageCounts.get('AGE_25_34') ?? 0);
    if (profilesWithAge > 0 && (youngCount / profilesWithAge) * 100 >= 50) {
      highlights.push('Young and diverse community');
    }
    if (interests[0]?.memberPct >= 50) highlights.push(`Strong interest in ${interests[0].name}`);
    if (avgExperienceRating != null && avgExperienceRating >= 4.0) highlights.push('High event attendance rate');

    return {
      stats: {
        totalMembers: memberCount,
        totalMemberGrowthPct,
        newMembersThisMonth: thisMonthNewMembers,
        newMemberGrowthPct,
        engagementRate,
        engagementRateDelta,
        avgExperienceRating,
        avgExperienceRatingDelta,
      },
      demographics: { ageDistribution, genderSplit },
      topCities,
      interests,
      activity: {
        eventViews: { total: totalViews, growthPct: growthPct(thisMonthViews, lastMonthViews) },
        comments:   { total: totalComments, growthPct: growthPct(thisMonthComments, lastMonthComments) },
        shares:     { total: totalShares, growthPct: growthPct(thisMonthShares, lastMonthShares) },
      },
      highlights,
    };
  }

  async getHostEligibleEvents(
    communityId: string,
    userId: string,
    query: { search?: string; page?: number; limit?: number },
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const community = await this.prisma.community.findFirst({
      where: { id: communityId, status: CommunityStatus.PUBLISHED, deletedAt: null },
      select: { id: true },
    });
    if (!community) throw new NotFoundException('Community not found');

    const memberRecord = await this.prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId, userId } },
      select: { status: true },
    });
    if (memberRecord?.status !== CommunityMemberStatus.ACTIVE) {
      throw new ForbiddenException('You must be an active member to view eligible events');
    }

    const linkedEventIds = (
      await this.prisma.communityEvent.findMany({ where: { communityId }, select: { eventId: true } })
    ).map((e) => e.eventId);

    const hostProfile = await this.prisma.hostProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!hostProfile) throw new NotFoundException('Host profile not found');

    const where: Prisma.EventWhereInput = {
      hostProfileId: hostProfile.id,
      status: EventStatus.PUBLISHED,
      ...(linkedEventIds.length ? { id: { notIn: linkedEventIds } } : {}),
      ...(query.search ? { title: { contains: query.search, mode: 'insensitive' } } : {}),
    };

    const [events, total] = await Promise.all([
      this.prisma.event.findMany({
        where,
        select: {
          id: true,
          title: true,
          eventDate: true,
          city: true,
          media: { where: { type: 'COVER' }, select: { url: true }, take: 1 },
          category: { select: { id: true, name: true } },
        },
        orderBy: { eventDate: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.event.count({ where }),
    ]);

    const data = await Promise.all(
      events.map(async (event) => {
        const cover = event.media[0] ?? null;
        const coverImageUrl = cover ? await this.storageService.getPresignedDownloadUrl(cover.url) : null;
        return { id: event.id, title: event.title, eventDate: event.eventDate, city: event.city, coverImageUrl, category: event.category };
      }),
    );

    return { data, total, page, limit };
  }

  async addEventAsHost(communityId: string, userId: string, dto: AddCommunityEventDto) {
    const community = await this.prisma.community.findFirst({
      where: { id: communityId, status: CommunityStatus.PUBLISHED, deletedAt: null },
      select: { id: true },
    });
    if (!community) throw new NotFoundException('Community not found');

    const memberRecord = await this.prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId, userId } },
      select: { status: true },
    });
    if (memberRecord?.status !== CommunityMemberStatus.ACTIVE) {
      throw new ForbiddenException('You must be an active member to add experiences');
    }

    const hostProfile = await this.prisma.hostProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!hostProfile) throw new NotFoundException('Host profile not found');

    const event = await this.prisma.event.findFirst({
      where: { id: dto.eventId, hostProfileId: hostProfile.id, status: EventStatus.PUBLISHED },
      select: { id: true },
    });
    if (!event) throw new NotFoundException('Event not found or not eligible for this community');

    await this.prisma.communityEvent.upsert({
      where: { communityId_eventId: { communityId, eventId: dto.eventId } },
      create: { communityId, eventId: dto.eventId, source: CommunityEventSource.MANUAL, addedBy: userId },
      update: { source: CommunityEventSource.MANUAL, addedBy: userId },
    });

    await this.recalculateExperienceCount(communityId);
    this.logUpdate(communityId);
    return { success: true, communityId, eventId: dto.eventId };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  private async assertExists(id: string) {
    const found = await this.prisma.community.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!found) throw new NotFoundException('Community not found');
  }

  private async assertSlugAvailable(slug: string, excludeId?: string) {
    const existing = await this.prisma.community.findUnique({ where: { slug }, select: { id: true } });
    if (existing && existing.id !== excludeId) throw new ConflictException('Slug is already in use');
  }

  private async recalculateMemberCount(id: string) {
    const count = await this.prisma.communityMember.count({
      where: { communityId: id, status: CommunityMemberStatus.ACTIVE },
    });
    await this.prisma.community.update({ where: { id }, data: { memberCount: count } });
  }

  private async recalculateExperienceCount(id: string) {
    const count = await this.prisma.communityEvent.count({ where: { communityId: id } });
    await this.prisma.community.update({ where: { id }, data: { experienceCount: count } });
  }

  private logUpdate(id: string) {
    this.auditLogService.log({
      action: AuditAction.COMMUNITY_UPDATED,
      entityType: ENTITY_TYPE,
      entityId: id,
    });
  }

  private async getMembershipSet(userId: string, communityIds: string[]): Promise<Set<string>> {
    if (!communityIds.length) return new Set();
    const rows = await this.prisma.communityMember.findMany({
      where: {
        userId,
        communityId: { in: communityIds },
        status: { in: [CommunityMemberStatus.ACTIVE, CommunityMemberStatus.PENDING] },
      },
      select: { communityId: true },
    });
    return new Set(rows.map((r) => r.communityId));
  }

  // ─── Save / unsave ─────────────────────────────────────────────────────────

  async saveCommunity(communityId: string, firebaseUid: string) {
    const [user, community] = await Promise.all([
      this.prisma.user.findUnique({ where: { firebaseUid }, select: { id: true } }),
      this.prisma.community.findFirst({ where: { id: communityId, status: CommunityStatus.PUBLISHED, deletedAt: null }, select: { id: true } }),
    ]);
    if (!user) throw new NotFoundException('User not found');
    if (!community) throw new NotFoundException('Community not found');

    await this.prisma.savedCommunity.upsert({
      where: { userId_communityId: { userId: user.id, communityId } },
      create: { userId: user.id, communityId },
      update: {},
    });
    return { saved: true };
  }

  async unsaveCommunity(communityId: string, firebaseUid: string) {
    const user = await this.prisma.user.findUnique({ where: { firebaseUid }, select: { id: true } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.savedCommunity.deleteMany({ where: { userId: user.id, communityId } });
    return { saved: false };
  }

  async listSaved(firebaseUid: string, query: ListSavedCommunitiesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const user = await this.prisma.user.findUnique({ where: { firebaseUid }, select: { id: true } });
    if (!user) throw new NotFoundException('User not found');

    const [rows, total] = await Promise.all([
      this.prisma.savedCommunity.findMany({
        where: { userId: user.id },
        include: {
          community: {
            select: {
              id: true,
              name: true,
              slug: true,
              description: true,
              type: true,
              access: true,
              primaryCity: true,
              communityCities: true,
              coverImageKey: true,
              iconKey: true,
              memberCount: true,
              experienceCount: true,
              category: { select: { id: true, name: true } },
              members: {
                where: { userId: user.id, status: { in: [CommunityMemberStatus.ACTIVE, CommunityMemberStatus.PENDING] } },
                select: { status: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.savedCommunity.count({ where: { userId: user.id } }),
    ]);

    const data = await Promise.all(
      rows.map(async ({ community, createdAt }) => {
        const { members, ...rest } = community;
        const isMember = members.length > 0;
        return { ...(await this.withSignedMedia(rest)), isMember, isSaved: true, savedAt: createdAt };
      }),
    );

    return { data, total, page, limit };
  }

  async listJoined(firebaseUid: string, query: ListJoinedCommunitiesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const user = await this.prisma.user.findUnique({ where: { firebaseUid }, select: { id: true } });
    if (!user) throw new NotFoundException('User not found');

    const memberWhere = {
      userId: user.id,
      status: { in: [CommunityMemberStatus.ACTIVE, CommunityMemberStatus.PENDING] },
      community: { deletedAt: null, status: CommunityStatus.PUBLISHED },
    };

    const [rows, total] = await Promise.all([
      this.prisma.communityMember.findMany({
        where: memberWhere,
        include: {
          community: {
            select: {
              id: true,
              name: true,
              slug: true,
              description: true,
              type: true,
              access: true,
              primaryCity: true,
              communityCities: true,
              coverImageKey: true,
              iconKey: true,
              memberCount: true,
              experienceCount: true,
              category: { select: { id: true, name: true } },
              savedBy: { where: { userId: user.id }, select: { id: true } },
            },
          },
        },
        orderBy: { joinedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.communityMember.count({ where: memberWhere }),
    ]);

    const data = await Promise.all(
      rows.map(async ({ community, role, status, joinedAt }) => {
        const { savedBy, ...rest } = community;
        return {
          ...(await this.withSignedMedia(rest)),
          role,
          memberStatus: status,
          joinedAt,
          isSaved: savedBy.length > 0,
        };
      }),
    );

    return { data, total, page, limit };
  }

  private async getSavedSet(userId: string, communityIds: string[]): Promise<Set<string>> {
    if (!communityIds.length) return new Set();
    const rows = await this.prisma.savedCommunity.findMany({
      where: { userId, communityId: { in: communityIds } },
      select: { communityId: true },
    });
    return new Set(rows.map((r) => r.communityId));
  }

  private ageRangeLabel(ageRange: string): string {
    const map: Record<string, string> = {
      UNDER_18: 'Under 18',
      AGE_18_24: '18-24',
      AGE_25_34: '25-34',
      AGE_35_44: '35-44',
      AGE_45_54: '45-54',
      AGE_55_PLUS: '55+',
    };
    return map[ageRange] ?? ageRange;
  }

  /** Replace stored S3 keys with presigned download URLs on cover/icon. */
  private async withSignedMedia<T extends { coverImageKey?: string | null; iconKey?: string | null }>(
    obj: T,
  ): Promise<T & { coverImageUrl: string | null; iconUrl: string | null }> {
    const [coverImageUrl, iconUrl] = await Promise.all([
      obj.coverImageKey ? this.storageService.getPresignedDownloadUrl(obj.coverImageKey) : Promise.resolve(null),
      obj.iconKey ? this.storageService.getPresignedDownloadUrl(obj.iconKey) : Promise.resolve(null),
    ]);
    return { ...obj, coverImageUrl, iconUrl };
  }
}
