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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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

type AuthedUser = { uid: string; dbUserId?: string; communityRole?: CommunityRole };

@ApiTags('Community Feed')
@ApiBearerAuth('firebase-token')
@UseGuards(FirebaseAuthGuard, CommunityRoleGuard)
@MinCommunityRole(CommunityRole.MEMBER)
@Controller('communities/:communityId/feed')
export class CommunityFeedController {
  constructor(private readonly feed: CommunityFeedService) {}

  // ─── Posts ──────────────────────────────────────────────────────────────────

  @Post('posts')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a feed post (text / photo / poll)' })
  createPost(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser() user: AuthedUser,
    @Body() dto: CreatePostDto,
  ) {
    return this.feed.createPost(communityId, user.dbUserId!, user.communityRole!, dto);
  }

  @Get('posts')
  @ApiOperation({ summary: 'List feed posts (pinned first, cursor-paginated)' })
  listPosts(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser('dbUserId') userId: string,
    @Query() query: ListPostsQueryDto,
  ) {
    return this.feed.listPosts(communityId, userId, query);
  }

  // ─── Discovery (declared before :postId to avoid capture) ────────────────────

  @Get('trending-topics')
  @ApiOperation({ summary: 'Trending topics by post count over a window' })
  trending(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Query() query: WindowQueryDto,
  ) {
    return this.feed.trendingTopics(communityId, query.windowDays ?? 7);
  }

  @Get('popular')
  @ApiOperation({ summary: 'Popular posts by engagement over a window' })
  popular(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser('dbUserId') userId: string,
    @Query() query: WindowQueryDto,
  ) {
    return this.feed.popular(communityId, userId, query.windowDays ?? 7, query.limit ?? 3);
  }

  @Get('bookmarks')
  @ApiOperation({ summary: 'My bookmarked posts in this community' })
  bookmarks(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser('dbUserId') userId: string,
  ) {
    return this.feed.listBookmarks(communityId, userId);
  }

  @Get('posts/:postId')
  @ApiOperation({ summary: 'Get a single post' })
  getPost(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('postId', ParseUUIDPipe) postId: string,
    @GetUser('dbUserId') userId: string,
  ) {
    return this.feed.getPost(communityId, postId, userId);
  }

  @Patch('posts/:postId')
  @ApiOperation({ summary: 'Edit own post' })
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
  @ApiOperation({ summary: 'Soft-delete a post (own or moderator+)' })
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
  @ApiOperation({ summary: 'Pin a post (moderator+)' })
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
  @ApiOperation({ summary: 'Unpin a post (moderator+)' })
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
  @ApiOperation({ summary: 'React to a post' })
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
  @ApiOperation({ summary: 'Remove a reaction' })
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
  @ApiOperation({ summary: 'Bookmark a post' })
  bookmark(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('postId', ParseUUIDPipe) postId: string,
    @GetUser('dbUserId') userId: string,
  ) {
    return this.feed.bookmark(communityId, postId, userId);
  }

  @Delete('posts/:postId/bookmark')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a bookmark' })
  unbookmark(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('postId', ParseUUIDPipe) postId: string,
    @GetUser('dbUserId') userId: string,
  ) {
    return this.feed.unbookmark(communityId, postId, userId);
  }

  @Post('posts/:postId/share')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a share' })
  share(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('postId', ParseUUIDPipe) postId: string,
    @GetUser('dbUserId') userId: string,
  ) {
    return this.feed.share(communityId, postId, userId);
  }

  @Post('posts/:postId/view')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a view (idempotent per user) — powers reach' })
  view(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('postId', ParseUUIDPipe) postId: string,
    @GetUser('dbUserId') userId: string,
  ) {
    return this.feed.recordView(communityId, postId, userId);
  }

  @Post('posts/:postId/poll/vote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Vote on a poll (single-choice)' })
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
  @ApiOperation({ summary: 'List comments (cursor-paginated)' })
  listComments(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('postId', ParseUUIDPipe) postId: string,
    @Query() query: ListPostsQueryDto,
  ) {
    return this.feed.listComments(communityId, postId, query.cursor, query.limit);
  }

  @Post('posts/:postId/comments')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a comment' })
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
  @ApiOperation({ summary: 'Delete a comment (own or moderator+)' })
  deleteComment(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('postId', ParseUUIDPipe) postId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @GetUser() user: AuthedUser,
  ) {
    return this.feed.deleteComment(communityId, postId, commentId, user.dbUserId!, user.communityRole!);
  }
}
