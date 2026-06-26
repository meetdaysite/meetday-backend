import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  CommunityRole,
  FeedPostType,
  PostReportStatus,
  PostStatus,
} from '@prisma/client';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { StorageService } from '../../common/storage/storage.service';
import { CommunityFeedService } from './community-feed.service';
import { CreatePostDto } from './dto/create-post.dto';
import { AdminListPostsQueryDto } from './dto/admin-feed-query.dto';

const STATS_TTL = 30;
const OVERVIEW_TTL = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const SPARK_DAYS = 7;

interface DailyRow {
  day: Date;
  count: number;
}

const REPORT_LABEL: Record<string, { label: string; severityColor: string }> = {
  HARASSMENT_OR_ABUSE: { label: 'Harassment / Abuse', severityColor: 'red' },
  INAPPROPRIATE_CONTENT: { label: 'Inappropriate Content', severityColor: 'orange' },
  SPAM_OR_PROMOTION: { label: 'Spam or Promotion', severityColor: 'yellow' },
};

@Injectable()
export class CommunityFeedAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
    private readonly feedService: CommunityFeedService,
    private readonly auditLog: AuditLogService,
  ) {}

  // ─── Stats ─────────────────────────────────────────────────────────────────

  async getStats(communityId: string) {
    const cacheKey = `admin:feed-stats:${communityId}`;
    const cached = await this.redis.get<unknown>(cacheKey);
    if (cached) return cached;

    const [postQueue, published, reported, pinned] = await Promise.all([
      this.prisma.communityPost.count({ where: { communityId, status: PostStatus.PENDING, deletedAt: null } }),
      this.prisma.communityPost.count({ where: { communityId, status: PostStatus.PUBLISHED, deletedAt: null } }),
      this.prisma.communityPost.count({ where: { communityId, deletedAt: null, reports: { some: { status: PostReportStatus.PENDING } } } }),
      this.prisma.communityPost.count({ where: { communityId, isPinned: true, deletedAt: null } }),
    ]);

    const payload = { postQueue, published, reported, pinned };
    await this.redis.set(cacheKey, payload, STATS_TTL);
    return payload;
  }

  // ─── Post List ─────────────────────────────────────────────────────────────

  async listPosts(communityId: string, query: AdminListPostsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where = this.buildWhere(communityId, query);

    let orderBy: object;
    if (query.sort === 'oldest') {
      orderBy = { createdAt: 'asc' };
    } else if (query.sort === 'most_engaged') {
      orderBy = { reactionCount: 'desc' };
    } else {
      orderBy = { createdAt: 'desc' };
    }

    const [rows, total] = await Promise.all([
      this.prisma.communityPost.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          author: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
          _count: { select: { reports: { where: { status: PostReportStatus.PENDING } } } },
        },
      }),
      this.prisma.communityPost.count({ where }),
    ]);

    const items = await Promise.all(
      rows.map(async (p) => ({
        id: p.id,
        postType: p.postType,
        status: p.status,
        content: p.content,
        mediaUrls: await Promise.all((p.mediaKeys ?? []).map((k) => this.storage.getPresignedDownloadUrl(k))),
        author: {
          id: p.author.id,
          name: `${p.author.firstName} ${p.author.lastName}`.trim(),
          avatarUrl: p.author.avatarUrl ? await this.storage.getPresignedDownloadUrl(p.author.avatarUrl) : null,
        },
        pendingReportCount: p._count.reports,
        counts: {
          reactions: p.reactionCount,
          comments: p.commentCount,
          shares: p.shareCount,
          views: p.viewCount,
        },
        isPinned: p.isPinned,
        deletedAt: p.deletedAt,
        createdAt: p.createdAt,
      })),
    );

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // ─── Approve / Reject ──────────────────────────────────────────────────────

  async approvePost(communityId: string, postId: string, actorId: string) {
    const post = await this.findAdminPost(communityId, postId);
    if (post.status !== PostStatus.PENDING) {
      throw new BadRequestException('Only PENDING posts can be approved');
    }
    await this.prisma.communityPost.update({ where: { id: postId }, data: { status: PostStatus.PUBLISHED } });
    this.auditLog.log({
      actorId,
      action: AuditAction.FEED_POST_APPROVED,
      entityType: 'CommunityPost',
      entityId: postId,
      metadata: { communityId },
    });
    return { success: true };
  }

  async rejectPost(communityId: string, postId: string, actorId: string) {
    const post = await this.findAdminPost(communityId, postId);
    if (post.status !== PostStatus.PENDING) {
      throw new BadRequestException('Only PENDING posts can be rejected');
    }
    await this.prisma.communityPost.update({ where: { id: postId }, data: { status: PostStatus.REJECTED } });
    this.auditLog.log({
      actorId,
      action: AuditAction.FEED_POST_REJECTED,
      entityType: 'CommunityPost',
      entityId: postId,
      metadata: { communityId },
    });
    return { success: true };
  }

  // ─── Admin Create ──────────────────────────────────────────────────────────

  async createAdminPost(communityId: string, actorId: string, dto: CreatePostDto) {
    const postType = dto.postType ?? (dto.pollOptions?.length ? FeedPostType.POLL : FeedPostType.TEXT);
    if (postType === FeedPostType.POLL && (!dto.pollOptions || dto.pollOptions.length < 2)) {
      throw new BadRequestException('A poll needs at least 2 options');
    }
    const post = await this.prisma.communityPost.create({
      data: {
        communityId,
        authorId: actorId,
        postType,
        category: dto.category,
        topic: dto.topic,
        eventId: dto.eventId,
        content: dto.content ?? '',
        mediaKeys: dto.mediaKeys ?? [],
        status: PostStatus.PUBLISHED,
        ...(postType === FeedPostType.POLL && dto.pollOptions
          ? { pollOptions: { create: dto.pollOptions.map((text, i) => ({ text, position: i })) } }
          : {}),
      },
      select: { id: true, status: true, createdAt: true },
    });
    this.auditLog.log({
      actorId,
      action: AuditAction.FEED_POST_CREATED_BY_ADMIN,
      entityType: 'CommunityPost',
      entityId: post.id,
      metadata: { communityId },
    });
    return post;
  }

  // ─── Pin / Delete (delegated) ──────────────────────────────────────────────

  async setPinned(communityId: string, postId: string, actorId: string, pinned: boolean) {
    return this.feedService.setPinned(communityId, postId, actorId, pinned);
  }

  async deletePost(communityId: string, postId: string, actorId: string) {
    await this.findAdminPost(communityId, postId);
    await this.prisma.communityPost.update({ where: { id: postId }, data: { deletedAt: new Date() } });
    this.auditLog.log({
      actorId,
      action: AuditAction.FEED_POST_DELETED_BY_MOD,
      entityType: 'CommunityPost',
      entityId: postId,
      metadata: { communityId },
    });
    return { success: true };
  }

  // ─── Feed Overview ──────────────────────────────────────────────────────────

  async getFeedOverview(communityId: string) {
    const cacheKey = `admin:feed-overview:${communityId}`;
    const cached = await this.redis.get<unknown>(cacheKey);
    if (cached) return cached;

    const now = Date.now();
    const since7 = new Date(now - SPARK_DAYS * DAY_MS);
    const since14 = new Date(now - 2 * SPARK_DAYS * DAY_MS);

    const [
      postsCurrent, postsPrior,
      reactionsCurrent, commentsCurrent, sharesCurrent,
      reactionsPrior, commentsPrior, sharesPrior,
      reportsCurrent, reportsPrior,
      approvedCurrent, approvedPrior,
    ] = await Promise.all([
      this.dailySeries7('community_posts', 'createdAt', communityId, since7, 'AND "deletedAt" IS NULL'),
      this.dailySeries7('community_posts', 'createdAt', communityId, since14, 'AND "deletedAt" IS NULL', since7),
      this.dailySeriesViaPost('community_post_reactions', communityId, since7),
      this.dailySeriesViaPost('community_post_comments', communityId, since7, 'AND t."deletedAt" IS NULL'),
      this.dailySeriesViaPost('community_post_shares', communityId, since7),
      this.dailySeriesViaPost('community_post_reactions', communityId, since14, '', since7),
      this.dailySeriesViaPost('community_post_comments', communityId, since14, 'AND t."deletedAt" IS NULL', since7),
      this.dailySeriesViaPost('community_post_shares', communityId, since14, '', since7),
      this.dailySeries7('community_post_reports', 'createdAt', communityId, since7),
      this.dailySeries7('community_post_reports', 'createdAt', communityId, since14, '', since7),
      this.approvedSeries(communityId, since7),
      this.approvedSeries(communityId, since14, since7),
    ]);

    const engCurrent = reactionsCurrent.map((v, i) => v + commentsCurrent[i] + sharesCurrent[i]);
    const engPrior = reactionsPrior.map((v, i) => v + commentsPrior[i] + sharesPrior[i]);

    const toStat = (current: number[], prior: number[]) => {
      const value = current.reduce((a, b) => a + b, 0);
      const priorTotal = prior.reduce((a, b) => a + b, 0);
      const deltaPct = Math.round(((value - priorTotal) / Math.max(priorTotal, 1)) * 100);
      return { value, deltaPct, sparkline: current };
    };

    const payload = {
      totalPosts: toStat(postsCurrent, postsPrior),
      engagement: toStat(engCurrent, engPrior),
      reportsReceived: toStat(reportsCurrent, reportsPrior),
      postsApproved: toStat(approvedCurrent, approvedPrior),
    };

    await this.redis.set(cacheKey, payload, OVERVIEW_TTL);
    return payload;
  }

  // ─── Recent Reports ────────────────────────────────────────────────────────

  async getRecentReports(communityId: string, limit = 10) {
    const rows = await this.prisma.communityPostReport.findMany({
      where: { communityId, status: PostReportStatus.PENDING },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        reporter: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        post: { select: { content: true } },
      },
    });

    return Promise.all(
      rows.map(async (r) => ({
        reportId: r.id,
        postId: r.postId,
        postSnippet: r.post.content?.slice(0, 120) ?? '',
        reporter: {
          name: `${r.reporter.firstName} ${r.reporter.lastName}`.trim(),
          avatarUrl: r.reporter.avatarUrl ? await this.storage.getPresignedDownloadUrl(r.reporter.avatarUrl) : null,
        },
        reason: r.reason,
        body: r.body,
        label: REPORT_LABEL[r.reason]?.label ?? r.reason,
        severityColor: REPORT_LABEL[r.reason]?.severityColor ?? 'grey',
        reportedAt: r.createdAt,
      })),
    );
  }

  // ─── Report Actions ────────────────────────────────────────────────────────

  async resolveReport(reportId: string, actorId: string) {
    await this.updateReport(reportId, PostReportStatus.RESOLVED, actorId);
    this.auditLog.log({
      actorId,
      action: AuditAction.FEED_POST_REPORT_RESOLVED,
      entityType: 'CommunityPostReport',
      entityId: reportId,
      metadata: {},
    });
    return { success: true };
  }

  async dismissReport(reportId: string, actorId: string) {
    await this.updateReport(reportId, PostReportStatus.DISMISSED, actorId);
    this.auditLog.log({
      actorId,
      action: AuditAction.FEED_POST_REPORT_DISMISSED,
      entityType: 'CommunityPostReport',
      entityId: reportId,
      metadata: {},
    });
    return { success: true };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async findAdminPost(communityId: string, postId: string) {
    const post = await this.prisma.communityPost.findFirst({
      where: { id: postId, communityId },
      select: { id: true, status: true, authorId: true },
    });
    if (!post) throw new NotFoundException('Post not found');
    return post;
  }

  private buildWhere(communityId: string, query: AdminListPostsQueryDto) {
    const { status, postType, authorId, search, from, to } = query;

    const dateRange =
      from || to
        ? {
            createdAt: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {};

    const typeFilter = postType ? { postType } : {};
    const authorFilter = authorId ? { authorId } : {};
    const searchFilter = search ? { content: { contains: search, mode: 'insensitive' as const } } : {};

    if (status === 'DELETED') {
      return { communityId, deletedAt: { not: null }, ...typeFilter, ...authorFilter, ...searchFilter, ...dateRange };
    }
    if (status === 'REPORTED') {
      return { communityId, deletedAt: null, reports: { some: { status: PostReportStatus.PENDING } }, ...typeFilter, ...authorFilter, ...searchFilter, ...dateRange };
    }
    if (status && ['PENDING', 'PUBLISHED', 'REJECTED'].includes(status)) {
      return { communityId, deletedAt: null, status: status as PostStatus, ...typeFilter, ...authorFilter, ...searchFilter, ...dateRange };
    }
    return { communityId, deletedAt: null, ...typeFilter, ...authorFilter, ...searchFilter, ...dateRange };
  }

  private async dailySeries7(
    table: string,
    tsColumn: string,
    communityId: string,
    since: Date,
    extraWhere = '',
    before?: Date,
  ): Promise<number[]> {
    const beforeClause = before ? `AND "${tsColumn}" < '${before.toISOString()}'` : '';
    const rows = await this.prisma.$queryRawUnsafe<DailyRow[]>(
      `SELECT date_trunc('day', "${tsColumn}") AS day, count(*)::int AS count
       FROM "${table}"
       WHERE "communityId" = $1 AND "${tsColumn}" >= $2 ${beforeClause} ${extraWhere}
       GROUP BY 1 ORDER BY 1`,
      communityId,
      since,
    );

    const buckets = new Array(SPARK_DAYS).fill(0);
    const startDay = new Date(since);
    startDay.setHours(0, 0, 0, 0);
    for (const r of rows) {
      const idx = Math.floor((new Date(r.day).getTime() - startDay.getTime()) / DAY_MS);
      if (idx >= 0 && idx < SPARK_DAYS) buckets[idx] = Number(r.count);
    }
    return buckets;
  }

  // For tables that reach the community via postId (reactions, comments, shares)
  private async dailySeriesViaPost(
    table: string,
    communityId: string,
    since: Date,
    extraWhere = '',
    before?: Date,
  ): Promise<number[]> {
    const beforeClause = before ? `AND t."createdAt" < '${before.toISOString()}'` : '';
    const rows = await this.prisma.$queryRawUnsafe<DailyRow[]>(
      `SELECT date_trunc('day', t."createdAt") AS day, count(*)::int AS count
       FROM "${table}" t
       JOIN "community_posts" p ON p.id = t."postId"
       WHERE p."communityId" = $1 AND t."createdAt" >= $2 ${beforeClause} ${extraWhere}
       GROUP BY 1 ORDER BY 1`,
      communityId,
      since,
    );

    const buckets = new Array(SPARK_DAYS).fill(0);
    const startDay = new Date(since);
    startDay.setHours(0, 0, 0, 0);
    for (const r of rows) {
      const idx = Math.floor((new Date(r.day).getTime() - startDay.getTime()) / DAY_MS);
      if (idx >= 0 && idx < SPARK_DAYS) buckets[idx] = Number(r.count);
    }
    return buckets;
  }

  private async approvedSeries(communityId: string, since: Date, before?: Date): Promise<number[]> {
    const beforeClause = before ? `AND "createdAt" < '${before.toISOString()}'` : '';
    const rows = await this.prisma.$queryRawUnsafe<DailyRow[]>(
      `SELECT date_trunc('day', "createdAt") AS day, count(*)::int AS count
       FROM "audit_logs"
       WHERE action = 'FEED_POST_APPROVED'
         AND (metadata->>'communityId') = $1
         AND "createdAt" >= $2 ${beforeClause}
       GROUP BY 1 ORDER BY 1`,
      communityId,
      since,
    );

    const buckets = new Array(SPARK_DAYS).fill(0);
    const startDay = new Date(since);
    startDay.setHours(0, 0, 0, 0);
    for (const r of rows) {
      const idx = Math.floor((new Date(r.day).getTime() - startDay.getTime()) / DAY_MS);
      if (idx >= 0 && idx < SPARK_DAYS) buckets[idx] = Number(r.count);
    }
    return buckets;
  }

  private async updateReport(reportId: string, status: PostReportStatus, resolvedBy: string) {
    const report = await this.prisma.communityPostReport.findUnique({ where: { id: reportId }, select: { id: true } });
    if (!report) throw new NotFoundException('Report not found');
    await this.prisma.communityPostReport.update({
      where: { id: reportId },
      data: { status, resolvedBy, resolvedAt: new Date() },
    });
  }
}
