import { InjectQueue } from '@nestjs/bull';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AnnouncementStatus,
  AuditAction,
  CommunityAnnouncement,
  Prisma,
} from '@prisma/client';
import { Queue } from 'bull';
import { AuditLogService } from '../audit-log/audit-log.service';
import { StorageService } from '../../common/storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminListAnnouncementsQueryDto } from './dto/admin-list-announcements-query.dto';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';

const ENTITY_TYPE = 'CommunityAnnouncement';

// Meetday-managed (ADMIN) announcements are presented under the brand identity
// rather than the individual admin's personal name/avatar.
const BRAND_AUTHOR_NAME = 'Meetday Team';

const AUTHOR_SELECT = {
  select: { id: true, firstName: true, lastName: true, avatarUrl: true },
} as const;

type AnnouncementWithAuthor = CommunityAnnouncement & {
  author: { id: string; firstName: string; lastName: string; avatarUrl: string | null };
};

@Injectable()
export class CommunityAnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly storage: StorageService,
    @InjectQueue('community-announcements') private readonly queue: Queue,
  ) {}

  // ─── Host mutations ─────────────────────────────────────────────────────────

  async createAsHost(communityId: string, hostId: string, dto: CreateAnnouncementDto) {
    const community = await this.prisma.community.findFirst({
      where: { id: communityId, deletedAt: null },
      select: { id: true },
    });
    if (!community) throw new NotFoundException('Community not found');

    const status = dto.status ?? AnnouncementStatus.PUBLISHED;
    const isScheduled = status === AnnouncementStatus.SCHEDULED;
    const isDraft = status === AnnouncementStatus.DRAFT;

    const announcement = await this.prisma.communityAnnouncement.create({
      data: {
        communityId,
        authorId: hostId,
        authorRole: 'HOST',
        category: dto.category,
        title: dto.title,
        body: dto.body,
        imageKey: dto.imageKey,
        status,
        scheduledAt: isScheduled && dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        publishedAt: isDraft || isScheduled ? null : new Date(),
      },
      include: { author: AUTHOR_SELECT },
    });

    this.auditLog.log({
      actorId: hostId,
      actorRole: 'HOST',
      action: AuditAction.ANNOUNCEMENT_CREATED,
      entityType: ENTITY_TYPE,
      entityId: announcement.id,
      metadata: { communityId, category: dto.category, status },
    });

    if (!isDraft) {
      const delay =
        isScheduled && dto.scheduledAt
          ? Math.max(0, new Date(dto.scheduledAt).getTime() - Date.now())
          : 0;
      await this.queue.add(
        'fan-out',
        { announcementId: announcement.id, communityId },
        { delay, removeOnComplete: true, attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      );
    }

    return this.present({ ...announcement, likedByMe: false, bookmarkedByMe: false });
  }

  async updateAsHost(communityId: string, id: string, hostId: string, dto: UpdateAnnouncementDto) {
    await this.findOrThrowOwned(communityId, id, hostId);

    const updated = await this.prisma.communityAnnouncement.update({
      where: { id },
      data: { category: dto.category, title: dto.title, body: dto.body, imageKey: dto.imageKey },
      include: { author: AUTHOR_SELECT },
    });

    this.auditLog.log({
      actorId: hostId,
      actorRole: 'HOST',
      action: AuditAction.ANNOUNCEMENT_UPDATED,
      entityType: ENTITY_TYPE,
      entityId: id,
      metadata: { communityId },
    });

    return this.present(updated);
  }

  async softDeleteAsHost(communityId: string, id: string, hostId: string) {
    await this.findOrThrowOwned(communityId, id, hostId);

    await this.prisma.communityAnnouncement.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    this.auditLog.log({
      actorId: hostId,
      actorRole: 'HOST',
      action: AuditAction.ANNOUNCEMENT_DELETED,
      entityType: ENTITY_TYPE,
      entityId: id,
      metadata: { communityId },
    });

    return { success: true };
  }

  async pinAsHost(communityId: string, id: string, hostId: string) {
    await this.findOrThrowOwned(communityId, id, hostId);

    const updated = await this.prisma.communityAnnouncement.update({
      where: { id },
      data: { isPinned: true, pinnedAt: new Date() },
      include: { author: AUTHOR_SELECT },
    });

    this.auditLog.log({
      actorId: hostId,
      actorRole: 'HOST',
      action: AuditAction.ANNOUNCEMENT_PINNED,
      entityType: ENTITY_TYPE,
      entityId: id,
      metadata: { communityId },
    });

    return this.present(updated);
  }

  async unpinAsHost(communityId: string, id: string, hostId: string) {
    await this.findOrThrowOwned(communityId, id, hostId);

    const updated = await this.prisma.communityAnnouncement.update({
      where: { id },
      data: { isPinned: false, pinnedAt: null },
      include: { author: AUTHOR_SELECT },
    });

    this.auditLog.log({
      actorId: hostId,
      actorRole: 'HOST',
      action: AuditAction.ANNOUNCEMENT_UNPINNED,
      entityType: ENTITY_TYPE,
      entityId: id,
      metadata: { communityId },
    });

    return this.present(updated);
  }

  // ─── Host reads ──────────────────────────────────────────────────────────────

  async listForHost(communityId: string, hostId: string, query: AdminListAnnouncementsQueryDto) {
    const { status, page = 1, limit = 10 } = query;

    const where: Prisma.CommunityAnnouncementWhereInput = {
      communityId,
      authorId: hostId,
      deletedAt: null,
      ...(status ? { status } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.communityAnnouncement.findMany({
        where,
        include: { author: AUTHOR_SELECT },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.communityAnnouncement.count({ where }),
    ]);

    return {
      items: await Promise.all(items.map((a) => this.present(a))),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async hostStats(communityId: string, hostId: string) {
    const windowStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const prevWindowStart = new Date(windowStart.getTime() - 7 * 24 * 60 * 60 * 1000);

    const baseWhere = { communityId, authorId: hostId, deletedAt: null } as const;

    const [published, scheduled, drafts, reachNow, reachPrev] = await Promise.all([
      this.prisma.communityAnnouncement.count({ where: { ...baseWhere, status: AnnouncementStatus.PUBLISHED } }),
      this.prisma.communityAnnouncement.count({ where: { ...baseWhere, status: AnnouncementStatus.SCHEDULED } }),
      this.prisma.communityAnnouncement.count({ where: { ...baseWhere, status: AnnouncementStatus.DRAFT } }),
      this.prisma.communityAnnouncement.aggregate({
        where: { ...baseWhere, status: AnnouncementStatus.PUBLISHED, publishedAt: { gte: windowStart } },
        _sum: { reachCount: true },
      }),
      this.prisma.communityAnnouncement.aggregate({
        where: { ...baseWhere, status: AnnouncementStatus.PUBLISHED, publishedAt: { gte: prevWindowStart, lt: windowStart } },
        _sum: { reachCount: true },
      }),
    ]);

    const reachNowVal = reachNow._sum.reachCount ?? 0;
    const reachPrevVal = reachPrev._sum.reachCount ?? 0;
    const reachChangePercent =
      reachPrevVal > 0 ? Math.round(((reachNowVal - reachPrevVal) / reachPrevVal) * 100) : null;

    return {
      published,
      scheduled,
      drafts,
      totalReach: { value: reachNowVal, changePercent: reachChangePercent, windowDays: 7 },
    };
  }

  // ─── Admin mutations ────────────────────────────────────────────────────────

  async create(communityId: string, authorId: string, dto: CreateAnnouncementDto) {
    const community = await this.prisma.community.findFirst({
      where: { id: communityId, deletedAt: null },
      select: { id: true },
    });
    if (!community) throw new NotFoundException('Community not found');

    const status = dto.status ?? AnnouncementStatus.PUBLISHED;
    const isScheduled = status === AnnouncementStatus.SCHEDULED;
    const isDraft = status === AnnouncementStatus.DRAFT;

    const announcement = await this.prisma.communityAnnouncement.create({
      data: {
        communityId,
        authorId,
        authorRole: 'ADMIN',
        category: dto.category,
        title: dto.title,
        body: dto.body,
        imageKey: dto.imageKey,
        status,
        scheduledAt: isScheduled && dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        publishedAt: isDraft || isScheduled ? null : new Date(),
      },
      include: { author: AUTHOR_SELECT },
    });

    this.auditLog.log({
      actorId: authorId,
      actorRole: 'ADMIN',
      action: AuditAction.ANNOUNCEMENT_CREATED,
      entityType: ENTITY_TYPE,
      entityId: announcement.id,
      metadata: { communityId, category: dto.category, status },
    });

    if (!isDraft) {
      const delay = isScheduled && dto.scheduledAt
        ? Math.max(0, new Date(dto.scheduledAt).getTime() - Date.now())
        : 0;
      await this.queue.add(
        'fan-out',
        { announcementId: announcement.id, communityId },
        { delay, removeOnComplete: true, attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      );
    }

    return this.present({ ...announcement, likedByMe: false, bookmarkedByMe: false });
  }

  async update(communityId: string, id: string, dto: UpdateAnnouncementDto, actorId: string) {
    await this.findOrThrow(communityId, id);

    const updated = await this.prisma.communityAnnouncement.update({
      where: { id },
      data: {
        category: dto.category,
        title: dto.title,
        body: dto.body,
        imageKey: dto.imageKey,
      },
      include: { author: AUTHOR_SELECT },
    });

    this.auditLog.log({
      actorId,
      actorRole: 'ADMIN',
      action: AuditAction.ANNOUNCEMENT_UPDATED,
      entityType: ENTITY_TYPE,
      entityId: id,
      metadata: { communityId },
    });

    return this.present(updated);
  }

  async softDelete(communityId: string, id: string, actorId: string) {
    await this.findOrThrow(communityId, id);

    await this.prisma.communityAnnouncement.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    this.auditLog.log({
      actorId,
      actorRole: 'ADMIN',
      action: AuditAction.ANNOUNCEMENT_DELETED,
      entityType: ENTITY_TYPE,
      entityId: id,
      metadata: { communityId },
    });

    return { success: true };
  }

  async pin(communityId: string, id: string, actorId: string) {
    await this.findOrThrow(communityId, id);

    const updated = await this.prisma.communityAnnouncement.update({
      where: { id },
      data: { isPinned: true, pinnedAt: new Date() },
      include: { author: AUTHOR_SELECT },
    });

    this.auditLog.log({
      actorId,
      actorRole: 'ADMIN',
      action: AuditAction.ANNOUNCEMENT_PINNED,
      entityType: ENTITY_TYPE,
      entityId: id,
      metadata: { communityId },
    });

    return this.present(updated);
  }

  async unpin(communityId: string, id: string, actorId: string) {
    await this.findOrThrow(communityId, id);

    const updated = await this.prisma.communityAnnouncement.update({
      where: { id },
      data: { isPinned: false, pinnedAt: null },
      include: { author: AUTHOR_SELECT },
    });

    this.auditLog.log({
      actorId,
      actorRole: 'ADMIN',
      action: AuditAction.ANNOUNCEMENT_UNPINNED,
      entityType: ENTITY_TYPE,
      entityId: id,
      metadata: { communityId },
    });

    return this.present(updated);
  }

  // ─── Admin reads ─────────────────────────────────────────────────────────

  async listAdmin(communityId: string, query: AdminListAnnouncementsQueryDto) {
    const { status, page = 1, limit = 10 } = query;

    const where: Prisma.CommunityAnnouncementWhereInput = {
      communityId,
      deletedAt: null,
      ...(status ? { status } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.communityAnnouncement.findMany({
        where,
        include: { author: AUTHOR_SELECT },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.communityAnnouncement.count({ where }),
    ]);

    return {
      items: await Promise.all(items.map((a) => this.present(a))),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async adminStats(communityId: string) {
    const windowStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const prevWindowStart = new Date(windowStart.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [published, scheduled, drafts, reachNow, reachPrev] = await Promise.all([
      this.prisma.communityAnnouncement.count({
        where: { communityId, deletedAt: null, status: AnnouncementStatus.PUBLISHED },
      }),
      this.prisma.communityAnnouncement.count({
        where: { communityId, deletedAt: null, status: AnnouncementStatus.SCHEDULED },
      }),
      this.prisma.communityAnnouncement.count({
        where: { communityId, deletedAt: null, status: AnnouncementStatus.DRAFT },
      }),
      this.prisma.communityAnnouncement.aggregate({
        where: {
          communityId,
          deletedAt: null,
          status: AnnouncementStatus.PUBLISHED,
          publishedAt: { gte: windowStart },
        },
        _sum: { reachCount: true },
      }),
      this.prisma.communityAnnouncement.aggregate({
        where: {
          communityId,
          deletedAt: null,
          status: AnnouncementStatus.PUBLISHED,
          publishedAt: { gte: prevWindowStart, lt: windowStart },
        },
        _sum: { reachCount: true },
      }),
    ]);

    const reachNowVal = reachNow._sum.reachCount ?? 0;
    const reachPrevVal = reachPrev._sum.reachCount ?? 0;
    const reachChangePercent =
      reachPrevVal > 0
        ? Math.round(((reachNowVal - reachPrevVal) / reachPrevVal) * 100)
        : null;

    return {
      published,
      scheduled,
      drafts,
      totalReach: {
        value: reachNowVal,
        changePercent: reachChangePercent,
        windowDays: 7,
      },
    };
  }

  // ─── Member reads ─────────────────────────────────────────────────────────

  async list(communityId: string, userId: string, cursor?: string, limit = 20) {
    await this.assertAnnouncementsEnabled(communityId);

    // Pinned announcements appear only on the first page, sorted to the top.
    const pinned = cursor
      ? []
      : await this.prisma.communityAnnouncement.findMany({
          where: { communityId, deletedAt: null, status: AnnouncementStatus.PUBLISHED, isPinned: true },
          orderBy: { pinnedAt: 'desc' },
          include: { author: AUTHOR_SELECT },
        });

    const feed = await this.prisma.communityAnnouncement.findMany({
      where: {
        communityId,
        deletedAt: null,
        status: AnnouncementStatus.PUBLISHED,
        isPinned: false,
        ...(cursor ? { publishedAt: { lt: new Date(cursor) } } : {}),
      },
      orderBy: { publishedAt: 'desc' },
      take: limit + 1,
      include: { author: AUTHOR_SELECT },
    });

    const hasMore = feed.length > limit;
    const feedPage = hasMore ? feed.slice(0, limit) : feed;
    const nextCursor = hasMore ? feedPage[feedPage.length - 1].publishedAt?.toISOString() ?? null : null;

    const items = [...pinned, ...feedPage];
    const enriched = await this.enrichForUser(items, userId);

    return { items: enriched, nextCursor };
  }

  async listBookmarks(communityId: string, userId: string) {
    const bookmarks = await this.prisma.announcementBookmark.findMany({
      where: { userId, announcement: { communityId, deletedAt: null, status: AnnouncementStatus.PUBLISHED } },
      orderBy: { createdAt: 'desc' },
      include: { announcement: { include: { author: AUTHOR_SELECT } } },
    });

    const items = bookmarks.map((b) => b.announcement);
    return this.enrichForUser(items, userId);
  }

  async getUnreadCount(communityId: string, userId: string): Promise<{ count: number }> {
    const member = await this.prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId, userId } },
      select: { lastReadAnnouncementsAt: true },
    });

    const count = await this.prisma.communityAnnouncement.count({
      where: {
        communityId,
        deletedAt: null,
        status: AnnouncementStatus.PUBLISHED,
        authorId: { not: userId },
        ...(member?.lastReadAnnouncementsAt
          ? { publishedAt: { gt: member.lastReadAnnouncementsAt } }
          : {}),
      },
    });

    return { count };
  }

  async markRead(communityId: string, userId: string) {
    await this.prisma.communityMember.update({
      where: { communityId_userId: { communityId, userId } },
      data: { lastReadAnnouncementsAt: new Date() },
    });
    return { success: true };
  }

  // ─── Likes ──────────────────────────────────────────────────────────────────

  async like(communityId: string, id: string, userId: string) {
    await this.findOrThrow(communityId, id);
    try {
      await this.prisma.$transaction([
        this.prisma.announcementLike.create({ data: { announcementId: id, userId } }),
        this.prisma.communityAnnouncement.update({
          where: { id },
          data: { likeCount: { increment: 1 } },
        }),
      ]);
    } catch (err) {
      if (!this.isUniqueViolation(err)) throw err;
      // Already liked — idempotent no-op
    }
    return { success: true };
  }

  async unlike(communityId: string, id: string, userId: string) {
    await this.findOrThrow(communityId, id);
    const { count } = await this.prisma.announcementLike.deleteMany({
      where: { announcementId: id, userId },
    });
    if (count > 0) {
      await this.prisma.communityAnnouncement.update({
        where: { id },
        data: { likeCount: { decrement: count } },
      });
    }
    return { success: true };
  }

  // ─── Bookmarks ────────────────────────────────────────────────────────────

  async bookmark(communityId: string, id: string, userId: string) {
    await this.findOrThrow(communityId, id);
    try {
      await this.prisma.$transaction([
        this.prisma.announcementBookmark.create({ data: { announcementId: id, userId } }),
        this.prisma.communityAnnouncement.update({
          where: { id },
          data: { bookmarkCount: { increment: 1 } },
        }),
      ]);
    } catch (err) {
      if (!this.isUniqueViolation(err)) throw err;
    }
    return { success: true };
  }

  async unbookmark(communityId: string, id: string, userId: string) {
    await this.findOrThrow(communityId, id);
    const { count } = await this.prisma.announcementBookmark.deleteMany({
      where: { announcementId: id, userId },
    });
    if (count > 0) {
      await this.prisma.communityAnnouncement.update({
        where: { id },
        data: { bookmarkCount: { decrement: count } },
      });
    }
    return { success: true };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async findOrThrowOwned(communityId: string, id: string, hostId: string) {
    const announcement = await this.prisma.communityAnnouncement.findFirst({
      where: { id, communityId, deletedAt: null },
    });
    if (!announcement) throw new NotFoundException('Announcement not found');
    if (announcement.authorId !== hostId)
      throw new ForbiddenException('You can only modify your own announcements');
    return announcement;
  }

  private async findOrThrow(communityId: string, id: string) {
    const announcement = await this.prisma.communityAnnouncement.findFirst({
      where: { id, communityId, deletedAt: null },
    });
    if (!announcement) throw new NotFoundException('Announcement not found');
    return announcement;
  }

  private async assertAnnouncementsEnabled(communityId: string) {
    const settings = await this.prisma.communitySettings.findUnique({
      where: { communityId },
      select: { announcementsEnabled: true },
    });
    if (settings && !settings.announcementsEnabled) {
      throw new ForbiddenException('Announcements are disabled for this community');
    }
  }

  private isUniqueViolation(err: unknown): boolean {
    return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
  }

  private async enrichForUser<T extends AnnouncementWithAuthor>(items: T[], userId: string) {
    if (items.length === 0) return [];

    const ids = items.map((a) => a.id);
    const [likes, bookmarks] = await Promise.all([
      this.prisma.announcementLike.findMany({
        where: { announcementId: { in: ids }, userId },
        select: { announcementId: true },
      }),
      this.prisma.announcementBookmark.findMany({
        where: { announcementId: { in: ids }, userId },
        select: { announcementId: true },
      }),
    ]);

    const likedSet = new Set(likes.map((l) => l.announcementId));
    const bookmarkedSet = new Set(bookmarks.map((b) => b.announcementId));

    return Promise.all(
      items.map((a) =>
        this.present({
          ...a,
          likedByMe: likedSet.has(a.id),
          bookmarkedByMe: bookmarkedSet.has(a.id),
        }),
      ),
    );
  }

  /**
   * Shapes an announcement for API responses: signs the cover image, and builds
   * a display `author` block. ADMIN-authored (Meetday-managed) announcements are
   * presented under the "Meetday Team" brand; HOST/MANAGER use the member's own
   * name + (signed) avatar. `authorRole` stays on the row for the badge.
   */
  private async present<T extends AnnouncementWithAuthor>(obj: T) {
    const isBrand = obj.authorRole === 'ADMIN';

    const [imageUrl, authorAvatarUrl] = await Promise.all([
      obj.imageKey ? this.storage.getPresignedDownloadUrl(obj.imageKey) : Promise.resolve(null),
      !isBrand && obj.author.avatarUrl
        ? this.storage.getPresignedDownloadUrl(obj.author.avatarUrl)
        : Promise.resolve(null),
    ]);

    const author = {
      id: obj.author.id,
      name: isBrand ? BRAND_AUTHOR_NAME : `${obj.author.firstName} ${obj.author.lastName}`.trim(),
      avatarUrl: authorAvatarUrl, // null for brand → frontend renders the Meetday logo
      isBrand,
    };

    return { ...obj, imageUrl, author };
  }
}
