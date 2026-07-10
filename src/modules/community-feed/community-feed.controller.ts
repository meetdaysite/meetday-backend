import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CommunityRole } from '@prisma/client';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { MinCommunityRole } from '../../common/decorators/min-community-role.decorator';
import { CommunityRoleGuard } from '../../common/guards/community-role.guard';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { CommunityFeedService } from './community-feed.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import {
  CreateCommentDto,
  ListPostsQueryDto,
  ReactionDto,
  VotePollDto,
  WindowQueryDto,
} from './dto/feed-misc.dto';
import {
  COMMENT_EXAMPLE,
  COMMENT_PAGE_EXAMPLE,
  FEED_PAGE_EXAMPLE,
  FEED_POST_EXAMPLE,
  SUCCESS_EXAMPLE,
  TRENDING_TOPICS_EXAMPLE,
} from './community-feed.swagger';

type AuthedUser = { uid: string; dbUserId?: string; communityRole?: CommunityRole };

@ApiTags('Community Feed')
@ApiBearerAuth('firebase-token')
@ApiParam({ name: 'communityId', description: 'Community UUID', format: 'uuid' })
@ApiResponse({ status: 400, description: 'Malformed UUID path parameter or invalid request body.' })
@ApiResponse({ status: 401, description: 'Missing or invalid Firebase token.' })
@ApiResponse({ status: 403, description: 'Caller is not a member of this community (minimum role: MEMBER).' })
@UseGuards(FirebaseAuthGuard, CommunityRoleGuard)
@MinCommunityRole(CommunityRole.MEMBER)
@Controller('communities/:communityId/feed')
export class CommunityFeedController {
  constructor(private readonly feed: CommunityFeedService) {}

  // ─── Posts ──────────────────────────────────────────────────────────────────

  @Post('posts')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a feed post (text / photo / poll)',
    description: `Publishes a new post to the community feed. The post type is taken from \`postType\`, or inferred as \`POLL\` when \`pollOptions\` are present, otherwise \`TEXT\`.

**Who can post** depends on the community's \`feedPosting\` policy:
- \`ALL_MEMBERS\` — any member (default).
- \`ADMINS_ONLY\` — managers and above only.
- \`ATTENDED_MEMBERS_ONLY\` — only members who attended a community event.

The feed must also be enabled (\`feedEnabled\`); otherwise the request is rejected.

**Media:** first request presigned uploads via the Storage API with context \`COMMUNITY_FEED_MEDIA\`, then pass the returned S3 keys in \`mediaKeys\`.

Returns the fully enriched post (viewer state, signed media URLs, author badge, poll results).`,
  })
  @ApiCreatedResponse({ description: 'The created, enriched post.', schema: { example: FEED_POST_EXAMPLE } })
  @ApiResponse({ status: 400, description: 'A poll needs at least 2 options, or the linked eventId is not associated with this community.' })
  @ApiResponse({ status: 403, description: 'Feed is disabled, or the posting policy forbids this member from posting.' })
  createPost(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser() user: AuthedUser,
    @Body() dto: CreatePostDto,
  ) {
    return this.feed.createPost(communityId, user.dbUserId!, user.communityRole!, dto);
  }

  @Get('posts')
  @ApiOperation({
    summary: 'List feed posts (pinned first, cursor-paginated)',
    description: `Returns posts newest-first. **Pinned posts** appear only on the **first page** (when no \`cursor\` is supplied), grouped at the top; subsequent pages contain only regular posts.

**Pagination:** pass the \`nextCursor\` from the previous response back as \`cursor\` to load the next page; \`nextCursor\` is \`null\` on the last page. Optionally filter by \`category\` and/or \`topic\`.

Each item is fully enriched with the viewer's reaction/bookmark/share state, signed media URLs, the author's badge, and poll results.`,
  })
  @ApiOkResponse({ description: 'A page of enriched posts plus the next cursor.', schema: { example: FEED_PAGE_EXAMPLE } })
  listPosts(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser('dbUserId') userId: string,
    @Query() query: ListPostsQueryDto,
  ) {
    return this.feed.listPosts(communityId, userId, query);
  }

  // ─── Discovery (declared before :postId to avoid capture) ────────────────────

  @Get('trending-topics')
  @ApiOperation({
    summary: 'Trending topics by post count over a window',
    description: `Returns the top topic tags ranked by how many posts used them within the last \`windowDays\` days (default 7), capped at 10. Powers the "Trending Topics" surface.

Routed before \`posts/:postId\` so the literal path is not captured as a post id.`,
  })
  @ApiOkResponse({ description: 'Topics with their post counts, most-used first.', schema: { example: TRENDING_TOPICS_EXAMPLE } })
  trending(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Query() query: WindowQueryDto,
  ) {
    return this.feed.trendingTopics(communityId, query.windowDays ?? 7);
  }

  @Get('popular')
  @ApiOperation({
    summary: 'Popular posts by engagement over a window',
    description: `Returns the most engaging posts (ranked by reactions + comments) created within the last \`windowDays\` days (default 7), limited to \`limit\` items (default 3). Each post is fully enriched.`,
  })
  @ApiOkResponse({ description: 'Top enriched posts by engagement.', schema: { example: [FEED_POST_EXAMPLE] } })
  popular(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser('dbUserId') userId: string,
    @Query() query: WindowQueryDto,
  ) {
    return this.feed.popular(communityId, userId, query.windowDays ?? 7, query.limit ?? 3);
  }

  @Get('bookmarks')
  @ApiOperation({
    summary: 'My bookmarked posts in this community',
    description: "The current user's bookmarked posts in this community, newest bookmark first. Soft-deleted posts are excluded. Each post is fully enriched.",
  })
  @ApiOkResponse({ description: 'Enriched posts the caller has bookmarked.', schema: { example: [FEED_POST_EXAMPLE] } })
  bookmarks(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser('dbUserId') userId: string,
  ) {
    return this.feed.listBookmarks(communityId, userId);
  }

  @Get('posts/:postId')
  @ApiOperation({
    summary: 'Get a single post',
    description: 'Returns one fully enriched post (viewer state, signed media, author badge, poll results).',
  })
  @ApiParam({ name: 'postId', description: 'Post UUID', format: 'uuid' })
  @ApiOkResponse({ description: 'The enriched post.', schema: { example: FEED_POST_EXAMPLE } })
  @ApiResponse({ status: 404, description: 'Post not found or has been deleted.' })
  getPost(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('postId', ParseUUIDPipe) postId: string,
    @GetUser('dbUserId') userId: string,
  ) {
    return this.feed.getPost(communityId, postId, userId);
  }

  @Patch('posts/:postId')
  @ApiOperation({
    summary: 'Edit own post',
    description: 'Updates the content, media, category, or topic of a post. Only the original author may edit; any other caller is rejected. Returns the updated, enriched post.',
  })
  @ApiParam({ name: 'postId', description: 'Post UUID', format: 'uuid' })
  @ApiOkResponse({ description: 'The updated, enriched post.', schema: { example: FEED_POST_EXAMPLE } })
  @ApiResponse({ status: 403, description: 'Caller is not the author of this post.' })
  @ApiResponse({ status: 404, description: 'Post not found or has been deleted.' })
  updatePost(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('postId', ParseUUIDPipe) postId: string,
    @GetUser('dbUserId') userId: string,
    @Body() dto: UpdatePostDto,
  ) {
    return this.feed.updatePost(communityId, postId, userId, dto);
  }

  @Delete('posts/:postId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Soft-delete a post (own or moderator+)',
    description: 'Soft-deletes a post (it stops appearing in the feed). Allowed for the post author or any moderator and above. Deletions performed by a moderator on someone else’s post are written to the audit log.',
  })
  @ApiParam({ name: 'postId', description: 'Post UUID', format: 'uuid' })
  @ApiOkResponse({ description: 'Post soft-deleted.', schema: { example: SUCCESS_EXAMPLE } })
  @ApiResponse({ status: 403, description: 'Caller is neither the author nor a moderator+.' })
  @ApiResponse({ status: 404, description: 'Post not found or already deleted.' })
  deletePost(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('postId', ParseUUIDPipe) postId: string,
    @GetUser() user: AuthedUser,
  ) {
    return this.feed.deletePost(communityId, postId, user.dbUserId!, user.communityRole!);
  }

  @Post('posts/:postId/pin')
  @HttpCode(HttpStatus.OK)
  @MinCommunityRole(CommunityRole.MODERATOR)
  @ApiOperation({
    summary: 'Pin a post (moderator+)',
    description: 'Pins a post so it surfaces at the top of the first feed page. Requires moderator role or above. Idempotent and audit-logged.',
  })
  @ApiParam({ name: 'postId', description: 'Post UUID', format: 'uuid' })
  @ApiOkResponse({ description: 'Post pinned.', schema: { example: SUCCESS_EXAMPLE } })
  @ApiResponse({ status: 403, description: 'Caller is below moderator role.' })
  @ApiResponse({ status: 404, description: 'Post not found or has been deleted.' })
  pin(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('postId', ParseUUIDPipe) postId: string,
    @GetUser('dbUserId') userId: string,
  ) {
    return this.feed.setPinned(communityId, postId, userId, true);
  }

  @Delete('posts/:postId/pin')
  @HttpCode(HttpStatus.OK)
  @MinCommunityRole(CommunityRole.MODERATOR)
  @ApiOperation({
    summary: 'Unpin a post (moderator+)',
    description: 'Removes a post from the pinned set. Requires moderator role or above. Idempotent and audit-logged.',
  })
  @ApiParam({ name: 'postId', description: 'Post UUID', format: 'uuid' })
  @ApiOkResponse({ description: 'Post unpinned.', schema: { example: SUCCESS_EXAMPLE } })
  @ApiResponse({ status: 403, description: 'Caller is below moderator role.' })
  @ApiResponse({ status: 404, description: 'Post not found or has been deleted.' })
  unpin(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('postId', ParseUUIDPipe) postId: string,
    @GetUser('dbUserId') userId: string,
  ) {
    return this.feed.setPinned(communityId, postId, userId, false);
  }

  // ─── Engagement ───────────────────────────────────────────────────────────

  @Post('posts/:postId/reactions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'React to a post',
    description: 'Adds an emoji reaction (sent in the body) on behalf of the caller. Idempotent — reacting again with the same emoji is a no-op and does not double-count.',
  })
  @ApiParam({ name: 'postId', description: 'Post UUID', format: 'uuid' })
  @ApiOkResponse({ description: 'Reaction recorded.', schema: { example: SUCCESS_EXAMPLE } })
  @ApiResponse({ status: 404, description: 'Post not found or has been deleted.' })
  react(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('postId', ParseUUIDPipe) postId: string,
    @GetUser('dbUserId') userId: string,
    @Body() dto: ReactionDto,
  ) {
    return this.feed.react(communityId, postId, userId, dto.emoji);
  }

  @Delete('posts/:postId/reactions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remove a reaction',
    description: 'Removes the caller’s emoji reaction (sent in the body) from the post. Idempotent — removing a reaction that was never added is a no-op.',
  })
  @ApiParam({ name: 'postId', description: 'Post UUID', format: 'uuid' })
  @ApiOkResponse({ description: 'Reaction removed.', schema: { example: SUCCESS_EXAMPLE } })
  @ApiResponse({ status: 404, description: 'Post not found or has been deleted.' })
  unreact(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('postId', ParseUUIDPipe) postId: string,
    @GetUser('dbUserId') userId: string,
    @Body() dto: ReactionDto,
  ) {
    return this.feed.unreact(communityId, postId, userId, dto.emoji);
  }

  @Post('posts/:postId/bookmark')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Bookmark a post',
    description: 'Saves the post to the caller’s bookmarks (see GET /bookmarks). Idempotent — bookmarking twice does not double-count.',
  })
  @ApiParam({ name: 'postId', description: 'Post UUID', format: 'uuid' })
  @ApiOkResponse({ description: 'Post bookmarked.', schema: { example: SUCCESS_EXAMPLE } })
  @ApiResponse({ status: 404, description: 'Post not found or has been deleted.' })
  bookmark(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('postId', ParseUUIDPipe) postId: string,
    @GetUser('dbUserId') userId: string,
  ) {
    return this.feed.bookmark(communityId, postId, userId);
  }

  @Delete('posts/:postId/bookmark')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remove a bookmark',
    description: 'Removes the post from the caller’s bookmarks. Idempotent — removing a non-existent bookmark is a no-op.',
  })
  @ApiParam({ name: 'postId', description: 'Post UUID', format: 'uuid' })
  @ApiOkResponse({ description: 'Bookmark removed.', schema: { example: SUCCESS_EXAMPLE } })
  @ApiResponse({ status: 404, description: 'Post not found or has been deleted.' })
  unbookmark(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('postId', ParseUUIDPipe) postId: string,
    @GetUser('dbUserId') userId: string,
  ) {
    return this.feed.unbookmark(communityId, postId, userId);
  }

  @Post('posts/:postId/share')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record a share',
    description: 'Records that the caller shared the post, incrementing its share count. Idempotent per user.',
  })
  @ApiParam({ name: 'postId', description: 'Post UUID', format: 'uuid' })
  @ApiOkResponse({ description: 'Share recorded.', schema: { example: SUCCESS_EXAMPLE } })
  @ApiResponse({ status: 404, description: 'Post not found or has been deleted.' })
  share(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('postId', ParseUUIDPipe) postId: string,
    @GetUser('dbUserId') userId: string,
  ) {
    return this.feed.share(communityId, postId, userId);
  }

  @Post('posts/:postId/view')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record a view (idempotent per user) — powers reach',
    description: 'Records that the caller viewed the post. Counted at most once per user (idempotent), so the resulting view count reflects unique reach. Safe to call on every impression.',
  })
  @ApiParam({ name: 'postId', description: 'Post UUID', format: 'uuid' })
  @ApiOkResponse({ description: 'View recorded (or already counted).', schema: { example: SUCCESS_EXAMPLE } })
  @ApiResponse({ status: 404, description: 'Post not found or has been deleted.' })
  view(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('postId', ParseUUIDPipe) postId: string,
    @GetUser('dbUserId') userId: string,
  ) {
    return this.feed.recordView(communityId, postId, userId);
  }

  @Post('posts/:postId/poll/vote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Vote on a poll (single-choice)',
    description: 'Casts a single-choice vote for the given `optionId`. Re-voting moves the caller’s vote to the new option (decrementing the old, incrementing the new); voting again for the same option is a no-op.',
  })
  @ApiParam({ name: 'postId', description: 'Post UUID', format: 'uuid' })
  @ApiOkResponse({ description: 'Vote recorded.', schema: { example: SUCCESS_EXAMPLE } })
  @ApiResponse({ status: 400, description: 'Post is not a poll, or the option does not belong to this poll.' })
  @ApiResponse({ status: 404, description: 'Post not found or has been deleted.' })
  vote(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('postId', ParseUUIDPipe) postId: string,
    @GetUser('dbUserId') userId: string,
    @Body() dto: VotePollDto,
  ) {
    return this.feed.votePoll(communityId, postId, userId, dto.optionId);
  }

  // ─── Comments ───────────────────────────────────────────────────────────────

  @Get('posts/:postId/comments')
  @ApiOperation({
    summary: 'List comments (cursor-paginated)',
    description: 'Returns a post’s comments newest-first. Pass the `nextCursor` from the previous response back as `cursor` to page; `nextCursor` is `null` on the last page. (Uses the same `cursor`/`limit` query params as the feed listing.)',
  })
  @ApiParam({ name: 'postId', description: 'Post UUID', format: 'uuid' })
  @ApiOkResponse({ description: 'A page of comments plus the next cursor.', schema: { example: COMMENT_PAGE_EXAMPLE } })
  @ApiResponse({ status: 404, description: 'Post not found or has been deleted.' })
  listComments(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('postId', ParseUUIDPipe) postId: string,
    @Query() query: ListPostsQueryDto,
  ) {
    return this.feed.listComments(communityId, postId, query.cursor, query.limit);
  }

  @Post('posts/:postId/comments')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add a comment',
    description: 'Adds a comment to the post and increments its comment count. Returns the created comment with its author summary.',
  })
  @ApiParam({ name: 'postId', description: 'Post UUID', format: 'uuid' })
  @ApiCreatedResponse({ description: 'The created comment.', schema: { example: COMMENT_EXAMPLE } })
  @ApiResponse({ status: 404, description: 'Post not found or has been deleted.' })
  addComment(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('postId', ParseUUIDPipe) postId: string,
    @GetUser('dbUserId') userId: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.feed.addComment(communityId, postId, userId, dto.content);
  }

  @Delete('posts/:postId/comments/:commentId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete a comment (own or moderator+)',
    description: 'Soft-deletes a comment and decrements the post’s comment count. Allowed for the comment author or any moderator and above.',
  })
  @ApiParam({ name: 'postId', description: 'Post UUID', format: 'uuid' })
  @ApiParam({ name: 'commentId', description: 'Comment UUID', format: 'uuid' })
  @ApiOkResponse({ description: 'Comment deleted.', schema: { example: SUCCESS_EXAMPLE } })
  @ApiResponse({ status: 403, description: 'Caller is neither the comment author nor a moderator+.' })
  @ApiResponse({ status: 404, description: 'Comment not found or already deleted.' })
  deleteComment(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('postId', ParseUUIDPipe) postId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @GetUser() user: AuthedUser,
  ) {
    return this.feed.deleteComment(communityId, postId, commentId, user.dbUserId!, user.communityRole!);
  }
}
