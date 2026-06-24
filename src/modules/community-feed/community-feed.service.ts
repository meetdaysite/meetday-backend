import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  CommunityRole,
  FeedPostType,
  PostingPermission,
  Prisma,
} from '@prisma/client';
import { AuditLogService } from '../audit-log/audit-log.service';
import { StorageService } from '../../common/storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { ListPostsQueryDto } from './dto/feed-misc.dto';

// Badge thresholds — mirror of community-members.service computeBadge (kept in sync).
const NEW_MEMBER_DAYS = 14;
const TOP_CONTRIBUTOR_SCORE = 50;
const ACTIVE_MEMBER_SCORE = 5;

const ROLE_RANK: CommunityRole[] = [
  CommunityRole.MEMBER,
  CommunityRole.MODERATOR,
  CommunityRole.HOST,
  CommunityRole.MANAGER,
  CommunityRole.OWNER,
];
const hasMinRole = (role: CommunityRole, min: CommunityRole) =>
  ROLE_RANK.indexOf(role) >= ROLE_RANK.indexOf(min);

const POST_INCLUDE = {
  author: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
  event: { select: { id: true, title: true, eventDate: true, city: true } },
  pollOptions: { orderBy: { position: 'asc' as const } },
} satisfies Prisma.CommunityPostInclude;

type PostRow = Prisma.CommunityPostGetPayload<{ include: typeof POST_INCLUDE }>;

type Badge = 'NEW_MEMBER' | 'TOP_CONTRIBUTOR' | 'ACTIVE_MEMBER' | null;

@Injectable()
export class CommunityFeedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly auditLog: AuditLogService,
  ) {}

  // ─── Posts ──────────────────────────────────────────────────────────────────

  async createPost(communityId: string, authorId: string, role: CommunityRole, dto: CreatePostDto) {
    await this.assertCanPost(communityId, authorId, role);

    const postType = dto.postType ?? (dto.pollOptions?.length ? FeedPostType.POLL : FeedPostType.TEXT);
    if (postType === FeedPostType.POLL && (!dto.pollOptions || dto.pollOptions.length < 2)) {
      throw new BadRequestException('A poll needs at least 2 options');
    }
    if (dto.eventId) {
      const linked = await this.prisma.communityEvent.findFirst({
        where: { communityId, eventId: dto.eventId },
        select: { id: true },
      });
      if (!linked) throw new BadRequestException('Event is not linked to this community');
    }

    const post = await this.prisma.communityPost.create({
      data: {
        communityId,
        authorId,
        postType,
        category: dto.category,
        topic: dto.topic,
        eventId: dto.eventId,
        content: dto.content ?? '',
        mediaKeys: dto.mediaKeys ?? [],
        ...(postType === FeedPostType.POLL && dto.pollOptions
          ? { pollOptions: { create: dto.pollOptions.map((text, i) => ({ text, position: i })) } }
          : {}),
      },
      include: POST_INCLUDE,
    });

    return this.present(post, authorId);
  }

  async listPosts(communityId: string, viewerId: string, query: ListPostsQueryDto) {
    const limit = query.limit ?? 20;

    // Pinned posts appear only on the first page, at the top.
    const pinned = query.cursor
      ? []
      : await this.prisma.communityPost.findMany({
          where: { communityId, deletedAt: null, isPinned: true, ...this.filter(query) },
          orderBy: { pinnedAt: 'desc' },
          include: POST_INCLUDE,
        });

    const feed = await this.prisma.communityPost.findMany({
      where: {
        communityId,
        deletedAt: null,
        isPinned: false,
        ...this.filter(query),
        ...(query.cursor ? { createdAt: { lt: new Date(query.cursor) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      include: POST_INCLUDE,
    });

    const hasMore = feed.length > limit;
    const page = hasMore ? feed.slice(0, limit) : feed;
    const nextCursor = hasMore ? page[page.length - 1].createdAt.toISOString() : null;

    const items = await this.enrich([...pinned, ...page], communityId, viewerId);
    return { items, nextCursor };
  }

  async getPost(communityId: string, postId: string, viewerId: string) {
    const post = await this.findOrThrow(communityId, postId);
    return (await this.enrich([post], communityId, viewerId))[0];
  }

  async updatePost(communityId: string, postId: string, userId: string, dto: UpdatePostDto) {
    const post = await this.findOrThrow(communityId, postId);
    if (post.authorId !== userId) throw new ForbiddenException('You can only edit your own post');

    const updated = await this.prisma.communityPost.update({
      where: { id: postId },
      data: { content: dto.content, mediaKeys: dto.mediaKeys, category: dto.category, topic: dto.topic },
      include: POST_INCLUDE,
    });
    return this.present(updated, userId);
  }

  async deletePost(communityId: string, postId: string, userId: string, role: CommunityRole) {
    const post = await this.findOrThrow(communityId, postId);
    const isMod = hasMinRole(role, CommunityRole.MODERATOR);
    if (post.authorId !== userId && !isMod) {
      throw new ForbiddenException('You cannot delete this post');
    }
    await this.prisma.communityPost.update({ where: { id: postId }, data: { deletedAt: new Date() } });
    if (post.authorId !== userId) {
      this.auditLog.log({
        actorId: userId,
        action: AuditAction.FEED_POST_DELETED_BY_MOD,
        entityType: 'CommunityPost',
        entityId: postId,
        metadata: { communityId, originalAuthorId: post.authorId },
      });
    }
    return { success: true };
  }

  async setPinned(communityId: string, postId: string, actorId: string, pinned: boolean) {
    await this.findOrThrow(communityId, postId);
    await this.prisma.communityPost.update({
      where: { id: postId },
      data: { isPinned: pinned, pinnedAt: pinned ? new Date() : null },
    });
    this.auditLog.log({
      actorId,
      action: pinned ? AuditAction.FEED_POST_PINNED : AuditAction.FEED_POST_UNPINNED,
      entityType: 'CommunityPost',
      entityId: postId,
      metadata: { communityId },
    });
    return { success: true };
  }

  // ─── Reactions / bookmarks / shares / views ─────────────────────────────────

  async react(communityId: string, postId: string, userId: string, emoji: string) {
    await this.findOrThrow(communityId, postId);
    try {
      await this.prisma.$transaction([
        this.prisma.communityPostReaction.create({ data: { postId, userId, emoji } }),
        this.prisma.communityPost.update({ where: { id: postId }, data: { reactionCount: { increment: 1 } } }),
      ]);
    } catch (err) {
      if (!this.isUnique(err)) throw err;
    }
    return { success: true };
  }

  async unreact(communityId: string, postId: string, userId: string, emoji: string) {
    await this.findOrThrow(communityId, postId);
    const { count } = await this.prisma.communityPostReaction.deleteMany({ where: { postId, userId, emoji } });
    if (count > 0) {
      await this.prisma.communityPost.update({ where: { id: postId }, data: { reactionCount: { decrement: count } } });
    }
    return { success: true };
  }

  async bookmark(communityId: string, postId: string, userId: string) {
    await this.findOrThrow(communityId, postId);
    try {
      await this.prisma.$transaction([
        this.prisma.communityPostBookmark.create({ data: { postId, userId } }),
        this.prisma.communityPost.update({ where: { id: postId }, data: { bookmarkCount: { increment: 1 } } }),
      ]);
    } catch (err) {
      if (!this.isUnique(err)) throw err;
    }
    return { success: true };
  }

  async unbookmark(communityId: string, postId: string, userId: string) {
    await this.findOrThrow(communityId, postId);
    const { count } = await this.prisma.communityPostBookmark.deleteMany({ where: { postId, userId } });
    if (count > 0) {
      await this.prisma.communityPost.update({ where: { id: postId }, data: { bookmarkCount: { decrement: count } } });
    }
    return { success: true };
  }

  async share(communityId: string, postId: string, userId: string) {
    await this.findOrThrow(communityId, postId);
    try {
      await this.prisma.$transaction([
        this.prisma.communityPostShare.create({ data: { postId, userId } }),
        this.prisma.communityPost.update({ where: { id: postId }, data: { shareCount: { increment: 1 } } }),
      ]);
    } catch (err) {
      if (!this.isUnique(err)) throw err;
    }
    return { success: true };
  }

  async recordView(communityId: string, postId: string, userId: string) {
    await this.findOrThrow(communityId, postId);
    try {
      await this.prisma.$transaction([
        this.prisma.communityPostView.create({ data: { postId, communityId, userId } }),
        this.prisma.communityPost.update({ where: { id: postId }, data: { viewCount: { increment: 1 } } }),
      ]);
    } catch (err) {
      if (!this.isUnique(err)) throw err; // already viewed — idempotent
    }
    return { success: true };
  }

  async listBookmarks(communityId: string, viewerId: string) {
    const bookmarks = await this.prisma.communityPostBookmark.findMany({
      where: { userId: viewerId, post: { communityId, deletedAt: null } },
      orderBy: { createdAt: 'desc' },
      include: { post: { include: POST_INCLUDE } },
    });
    return this.enrich(
      bookmarks.map((b) => b.post),
      communityId,
      viewerId,
    );
  }

  // ─── Comments ───────────────────────────────────────────────────────────────

  async addComment(communityId: string, postId: string, userId: string, content: string) {
    await this.findOrThrow(communityId, postId);
    const [comment] = await this.prisma.$transaction([
      this.prisma.communityPostComment.create({
        data: { postId, authorId: userId, content },
        include: { author: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
      }),
      this.prisma.communityPost.update({ where: { id: postId }, data: { commentCount: { increment: 1 } } }),
    ]);
    return this.presentComment(comment);
  }

  async listComments(communityId: string, postId: string, cursor?: string, limit = 30) {
    await this.findOrThrow(communityId, postId);
    const comments = await this.prisma.communityPostComment.findMany({
      where: { postId, deletedAt: null, ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      include: { author: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
    });
    const hasMore = comments.length > limit;
    const page = hasMore ? comments.slice(0, limit) : comments;
    const nextCursor = hasMore ? page[page.length - 1].createdAt.toISOString() : null;
    return { comments: await Promise.all(page.map((c) => this.presentComment(c))), nextCursor };
  }

  async deleteComment(communityId: string, postId: string, commentId: string, userId: string, role: CommunityRole) {
    const comment = await this.prisma.communityPostComment.findFirst({
      where: { id: commentId, postId, deletedAt: null },
      select: { authorId: true },
    });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.authorId !== userId && !hasMinRole(role, CommunityRole.MODERATOR)) {
      throw new ForbiddenException('You cannot delete this comment');
    }
    await this.prisma.$transaction([
      this.prisma.communityPostComment.update({ where: { id: commentId }, data: { deletedAt: new Date() } }),
      this.prisma.communityPost.update({ where: { id: postId }, data: { commentCount: { decrement: 1 } } }),
    ]);
    return { success: true };
  }

  // ─── Polls ──────────────────────────────────────────────────────────────────

  async votePoll(communityId: string, postId: string, userId: string, optionId: string) {
    const post = await this.findOrThrow(communityId, postId);
    if (post.postType !== FeedPostType.POLL) throw new BadRequestException('This post is not a poll');

    const option = await this.prisma.communityPostPollOption.findFirst({
      where: { id: optionId, postId },
      select: { id: true },
    });
    if (!option) throw new BadRequestException('Invalid poll option');

    const existing = await this.prisma.communityPostPollVote.findUnique({
      where: { postId_userId: { postId, userId } },
      select: { optionId: true },
    });

    if (existing?.optionId === optionId) return { success: true };

    if (existing) {
      await this.prisma.$transaction([
        this.prisma.communityPostPollVote.update({ where: { postId_userId: { postId, userId } }, data: { optionId } }),
        this.prisma.communityPostPollOption.update({ where: { id: existing.optionId }, data: { voteCount: { decrement: 1 } } }),
        this.prisma.communityPostPollOption.update({ where: { id: optionId }, data: { voteCount: { increment: 1 } } }),
      ]);
    } else {
      await this.prisma.$transaction([
        this.prisma.communityPostPollVote.create({ data: { postId, userId, optionId } }),
        this.prisma.communityPostPollOption.update({ where: { id: optionId }, data: { voteCount: { increment: 1 } } }),
      ]);
    }
    return { success: true };
  }

  // ─── Discovery ──────────────────────────────────────────────────────────────

  async trendingTopics(communityId: string, windowDays: number) {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.communityPost.groupBy({
      by: ['topic'],
      where: { communityId, deletedAt: null, topic: { not: null }, createdAt: { gte: since } },
      _count: { _all: true },
      orderBy: { _count: { topic: 'desc' } },
      take: 10,
    });
    return rows.map((r) => ({ topic: r.topic, postCount: r._count._all }));
  }

  async popular(communityId: string, viewerId: string, windowDays: number, limit: number) {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const candidates = await this.prisma.communityPost.findMany({
      where: { communityId, deletedAt: null, createdAt: { gte: since } },
      orderBy: { reactionCount: 'desc' },
      take: 100,
      include: POST_INCLUDE,
    });
    const ranked = candidates
      .sort((a, b) => b.reactionCount + b.commentCount - (a.reactionCount + a.commentCount))
      .slice(0, limit);
    return this.enrich(ranked, communityId, viewerId);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private filter(query: ListPostsQueryDto): Prisma.CommunityPostWhereInput {
    return {
      ...(query.category ? { category: query.category } : {}),
      ...(query.topic ? { topic: query.topic } : {}),
    };
  }

  private async findOrThrow(communityId: string, postId: string): Promise<PostRow> {
    const post = await this.prisma.communityPost.findFirst({
      where: { id: postId, communityId, deletedAt: null },
      include: POST_INCLUDE,
    });
    if (!post) throw new NotFoundException('Post not found');
    return post;
  }

  private isUnique(err: unknown): boolean {
    return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
  }

  private async assertCanPost(communityId: string, userId: string, role: CommunityRole) {
    const settings = await this.prisma.communitySettings.findUnique({
      where: { communityId },
      select: { feedEnabled: true, feedPosting: true },
    });
    if (settings && !settings.feedEnabled) {
      throw new ForbiddenException('The feed is disabled for this community');
    }
    const policy = settings?.feedPosting ?? PostingPermission.ALL_MEMBERS;
    if (policy === PostingPermission.ADMINS_ONLY && !hasMinRole(role, CommunityRole.MANAGER)) {
      throw new ForbiddenException('Only community managers can post here');
    }
    if (policy === PostingPermission.ATTENDED_MEMBERS_ONLY) {
      const attended = await this.prisma.orderAttendee.findFirst({
        where: {
          userId,
          orderItem: { order: { status: 'CONFIRMED', event: { communities: { some: { communityId } } } } },
        },
        select: { id: true },
      });
      if (!attended) throw new ForbiddenException('Only members who attended an event can post here');
    }
  }

  private computeBadge(joinedAt: Date | null, activityScore: number): Badge {
    if (joinedAt && joinedAt >= new Date(Date.now() - NEW_MEMBER_DAYS * 24 * 60 * 60 * 1000)) return 'NEW_MEMBER';
    if (activityScore >= TOP_CONTRIBUTOR_SCORE) return 'TOP_CONTRIBUTOR';
    if (activityScore >= ACTIVE_MEMBER_SCORE) return 'ACTIVE_MEMBER';
    return null;
  }

  private async signMany(keys: string[]): Promise<string[]> {
    return Promise.all(keys.map((k) => this.storage.getPresignedDownloadUrl(k)));
  }

  private async present(post: PostRow, viewerId: string) {
    return (await this.enrich([post], post.communityId, viewerId))[0];
  }

  private async presentComment(c: {
    id: string;
    postId: string;
    content: string;
    createdAt: Date;
    author: { id: string; firstName: string; lastName: string; avatarUrl: string | null };
  }) {
    return {
      id: c.id,
      postId: c.postId,
      content: c.content,
      createdAt: c.createdAt,
      author: {
        id: c.author.id,
        name: `${c.author.firstName} ${c.author.lastName}`.trim(),
        avatarUrl: c.author.avatarUrl ? await this.storage.getPresignedDownloadUrl(c.author.avatarUrl) : null,
      },
    };
  }

  /** Batch-enrich posts with viewer state, signed media, author badge, poll results. */
  private async enrich(posts: PostRow[], communityId: string, viewerId: string) {
    if (posts.length === 0) return [];
    const ids = posts.map((p) => p.id);
    const authorIds = [...new Set(posts.map((p) => p.authorId))];

    const [reactions, bookmarks, shares, votes, members] = await Promise.all([
      this.prisma.communityPostReaction.findMany({ where: { postId: { in: ids }, userId: viewerId }, select: { postId: true, emoji: true } }),
      this.prisma.communityPostBookmark.findMany({ where: { postId: { in: ids }, userId: viewerId }, select: { postId: true } }),
      this.prisma.communityPostShare.findMany({ where: { postId: { in: ids }, userId: viewerId }, select: { postId: true } }),
      this.prisma.communityPostPollVote.findMany({ where: { postId: { in: ids }, userId: viewerId }, select: { postId: true, optionId: true } }),
      this.prisma.communityMember.findMany({
        where: { communityId, userId: { in: authorIds } },
        select: { userId: true, joinedAt: true, activityScore: true },
      }),
    ]);

    const myReactions = new Map<string, string[]>();
    for (const r of reactions) myReactions.set(r.postId, [...(myReactions.get(r.postId) ?? []), r.emoji]);
    const bookmarked = new Set(bookmarks.map((b) => b.postId));
    const shared = new Set(shares.map((s) => s.postId));
    const myVote = new Map(votes.map((v) => [v.postId, v.optionId]));
    const memberMap = new Map(members.map((m) => [m.userId, m]));

    return Promise.all(
      posts.map(async (p) => {
        const m = memberMap.get(p.authorId);
        const [mediaUrls, avatarUrl] = await Promise.all([
          this.signMany(p.mediaKeys),
          p.author.avatarUrl ? this.storage.getPresignedDownloadUrl(p.author.avatarUrl) : Promise.resolve(null),
        ]);

        const totalVotes = p.pollOptions.reduce((s, o) => s + o.voteCount, 0);

        return {
          id: p.id,
          communityId: p.communityId,
          postType: p.postType,
          category: p.category,
          topic: p.topic,
          content: p.content,
          mediaUrls,
          author: {
            id: p.author.id,
            name: `${p.author.firstName} ${p.author.lastName}`.trim(),
            avatarUrl,
            badge: m ? this.computeBadge(m.joinedAt, m.activityScore) : null,
          },
          event: p.event
            ? { id: p.event.id, title: p.event.title, eventDate: p.event.eventDate, city: p.event.city }
            : null,
          poll:
            p.postType === FeedPostType.POLL
              ? {
                  totalVotes,
                  myVote: myVote.get(p.id) ?? null,
                  options: p.pollOptions.map((o) => ({ id: o.id, text: o.text, voteCount: o.voteCount })),
                }
              : null,
          isPinned: p.isPinned,
          counts: {
            reactions: p.reactionCount,
            comments: p.commentCount,
            shares: p.shareCount,
            views: p.viewCount,
            bookmarks: p.bookmarkCount,
          },
          reactedByMe: (myReactions.get(p.id) ?? []).length > 0,
          myReactions: myReactions.get(p.id) ?? [],
          bookmarkedByMe: bookmarked.has(p.id),
          sharedByMe: shared.has(p.id),
          createdAt: p.createdAt,
        };
      }),
    );
  }
}
