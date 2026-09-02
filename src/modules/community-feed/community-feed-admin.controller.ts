import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CommunityFeedAdminService } from './community-feed-admin.service';
import { CreatePostDto } from './dto/create-post.dto';
import { AdminListPostsQueryDto } from './dto/admin-feed-query.dto';
import {
  APPROVE_POST_EXAMPLE,
  CREATE_ADMIN_POST_EXAMPLE,
  DELETE_POST_EXAMPLE,
  DISMISS_REPORT_EXAMPLE,
  FEED_OVERVIEW_EXAMPLE,
  FEED_STATS_EXAMPLE,
  LIST_POSTS_EXAMPLE,
  PIN_POST_EXAMPLE,
  RECENT_REPORTS_EXAMPLE,
  REJECT_POST_EXAMPLE,
  RESOLVE_REPORT_EXAMPLE,
  UNPIN_POST_EXAMPLE,
} from './community-feed-admin.swagger';

const COMMUNITY_ID_PARAM = {
  name: 'communityId',
  description: 'UUID of the community.',
  example: 'c1d2e3f4-a5b6-7890-cdef-012345678901',
};

const POST_ID_PARAM = {
  name: 'postId',
  description: 'UUID of the post.',
  example: 'p1a2b3c4-d5e6-7890-abcd-ef1234567890',
};

@ApiTags('Community Feed (Admin)')
@ApiBearerAuth('firebase-token')
@UseGuards(RolesGuard)
@Roles('SUPER_ADMIN', 'CITY_ADMIN')
@Controller('admin/communities/:communityId/feed')
export class CommunityFeedAdminController {
  constructor(private readonly service: CommunityFeedAdminService) {}

  // ─── Stats ──────────────────────────────────────────────────────────────────

  @Get('stats')
  @Roles('SUPER_ADMIN', 'CITY_ADMIN', 'MODERATOR')
  @ApiOperation({
    summary: 'Feed stat cards',
    description:
      'Returns the 4 stat card counts for the admin Feed tab:\n\n' +
      '- **postQueue** — posts awaiting approval (`PENDING` status)\n' +
      '- **published** — live posts visible in the member feed\n' +
      '- **reported** — posts with at least one unresolved member report\n' +
      '- **pinned** — currently pinned posts\n\n' +
      'Cached in Redis for 30 seconds.',
  })
  @ApiParam(COMMUNITY_ID_PARAM)
  @ApiOkResponse({ description: '4 stat card counts.', schema: { example: FEED_STATS_EXAMPLE } })
  getStats(@Param('communityId', ParseUUIDPipe) communityId: string) {
    return this.service.getStats(communityId);
  }

  // ─── Overview sparklines ────────────────────────────────────────────────────

  @Get('overview')
  @Roles('SUPER_ADMIN', 'CITY_ADMIN', 'MODERATOR')
  @ApiOperation({
    summary: 'Feed overview sparklines (right sidebar)',
    description:
      'Returns 7-day sparkline data for 4 metrics with `deltaPct` vs the prior 7 days:\n\n' +
      '- **totalPosts** — posts created (excluding deleted)\n' +
      '- **engagement** — reactions + comments + shares combined\n' +
      '- **reportsReceived** — new member reports filed\n' +
      '- **postsApproved** — posts moved from PENDING → PUBLISHED by an admin\n\n' +
      'Each series has `value` (7-day total), `deltaPct` (% change vs prior period), and `sparkline` (array of 7 daily counts, oldest→newest).\n\n' +
      'Cached in Redis for 60 seconds.',
  })
  @ApiParam(COMMUNITY_ID_PARAM)
  @ApiOkResponse({ description: '7-day sparklines for 4 feed metrics.', schema: { example: FEED_OVERVIEW_EXAMPLE } })
  getOverview(@Param('communityId', ParseUUIDPipe) communityId: string) {
    return this.service.getFeedOverview(communityId);
  }

  // ─── Post list ──────────────────────────────────────────────────────────────

  @Get('posts')
  @Roles('SUPER_ADMIN', 'CITY_ADMIN', 'MODERATOR')
  @ApiOperation({
    summary: 'List posts (admin view, offset-paginated)',
    description:
      'Returns a paginated list of community posts for admin review. Unlike the member feed, this endpoint:\n\n' +
      '- Returns posts of **all statuses** unless `status` is specified\n' +
      '- Includes soft-deleted posts when `status=DELETED`\n' +
      '- Includes `pendingReportCount` (unresolved reports) on each post\n' +
      '- Does **not** include viewer-specific state (liked, bookmarked, voted)\n\n' +
      '**Virtual status filters:**\n' +
      '- `REPORTED` — posts with ≥1 unresolved report (not a real `PostStatus` value)\n' +
      '- `DELETED` — soft-deleted posts (`deletedAt IS NOT NULL`)',
  })
  @ApiParam(COMMUNITY_ID_PARAM)
  @ApiOkResponse({
    description: 'Paginated post list with total and page metadata.',
    schema: {
      examples: {
        allPosts: { summary: 'All posts (no filter)', value: LIST_POSTS_EXAMPLE },
      },
    },
  })
  listPosts(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Query() query: AdminListPostsQueryDto,
  ) {
    return this.service.listPosts(communityId, query);
  }

  // ─── Admin create post ──────────────────────────────────────────────────────

  @Post('posts')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create post as admin (always published)',
    description:
      'Creates a post directly in the community feed with `status: PUBLISHED`, bypassing all member policy checks (`feedPosting`, `requirePostApproval`, attended-members gate). ' +
      'The admin user is set as the post author. Audit-logged as `FEED_POST_CREATED_BY_ADMIN`.',
  })
  @ApiParam(COMMUNITY_ID_PARAM)
  @ApiOkResponse({ description: 'Created post stub.', schema: { example: CREATE_ADMIN_POST_EXAMPLE } })
  createPost(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser('id') actorId: string,
    @Body() dto: CreatePostDto,
  ) {
    return this.service.createAdminPost(communityId, actorId, dto);
  }

  // ─── Approve ────────────────────────────────────────────────────────────────

  @Post('posts/:postId/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve a pending post',
    description:
      'Moves a `PENDING` post to `PUBLISHED`, making it visible in the member feed. ' +
      'Throws `400` if the post is not in `PENDING` status. Audit-logged as `FEED_POST_APPROVED`.',
  })
  @ApiParam(COMMUNITY_ID_PARAM)
  @ApiParam(POST_ID_PARAM)
  @ApiOkResponse({ schema: { example: APPROVE_POST_EXAMPLE } })
  @ApiBadRequestResponse({ description: 'Post is not in PENDING status.' })
  @ApiNotFoundResponse({ description: 'Post not found.' })
  approvePost(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('postId', ParseUUIDPipe) postId: string,
    @GetUser('id') actorId: string,
  ) {
    return this.service.approvePost(communityId, postId, actorId);
  }

  // ─── Reject ─────────────────────────────────────────────────────────────────

  @Post('posts/:postId/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reject a pending post',
    description:
      'Moves a `PENDING` post to `REJECTED`. The post is not visible in the member feed and cannot be approved later. ' +
      'Throws `400` if the post is not in `PENDING` status. Audit-logged as `FEED_POST_REJECTED`.',
  })
  @ApiParam(COMMUNITY_ID_PARAM)
  @ApiParam(POST_ID_PARAM)
  @ApiOkResponse({ schema: { example: REJECT_POST_EXAMPLE } })
  @ApiBadRequestResponse({ description: 'Post is not in PENDING status.' })
  @ApiNotFoundResponse({ description: 'Post not found.' })
  rejectPost(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('postId', ParseUUIDPipe) postId: string,
    @GetUser('id') actorId: string,
  ) {
    return this.service.rejectPost(communityId, postId, actorId);
  }

  // ─── Delete ─────────────────────────────────────────────────────────────────

  @Delete('posts/:postId')
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete any post (admin)',
    description:
      'Soft-deletes any post regardless of its status or author. Sets `deletedAt` to now. ' +
      'Audit-logged as `FEED_POST_DELETED_BY_MOD`.',
  })
  @ApiParam(COMMUNITY_ID_PARAM)
  @ApiParam(POST_ID_PARAM)
  @ApiOkResponse({ schema: { example: DELETE_POST_EXAMPLE } })
  @ApiNotFoundResponse({ description: 'Post not found.' })
  deletePost(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('postId', ParseUUIDPipe) postId: string,
    @GetUser('id') actorId: string,
  ) {
    return this.service.deletePost(communityId, postId, actorId);
  }

  // ─── Pin ────────────────────────────────────────────────────────────────────

  @Post('posts/:postId/pin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Pin a post',
    description: 'Sets `isPinned: true` on the post, causing it to appear at the top of the member feed on page 1. Audit-logged as `FEED_POST_PINNED`.',
  })
  @ApiParam(COMMUNITY_ID_PARAM)
  @ApiParam(POST_ID_PARAM)
  @ApiOkResponse({ schema: { example: PIN_POST_EXAMPLE } })
  @ApiNotFoundResponse({ description: 'Post not found or not published.' })
  pinPost(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('postId', ParseUUIDPipe) postId: string,
    @GetUser('id') actorId: string,
  ) {
    return this.service.setPinned(communityId, postId, actorId, true);
  }

  @Delete('posts/:postId/pin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Unpin a post',
    description: 'Sets `isPinned: false` on the post. Audit-logged as `FEED_POST_UNPINNED`.',
  })
  @ApiParam(COMMUNITY_ID_PARAM)
  @ApiParam(POST_ID_PARAM)
  @ApiOkResponse({ schema: { example: UNPIN_POST_EXAMPLE } })
  @ApiNotFoundResponse({ description: 'Post not found or not published.' })
  unpinPost(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('postId', ParseUUIDPipe) postId: string,
    @GetUser('id') actorId: string,
  ) {
    return this.service.setPinned(communityId, postId, actorId, false);
  }

  // ─── Recent Reports ─────────────────────────────────────────────────────────

  @Get('reports/recent')
  @Roles('SUPER_ADMIN', 'CITY_ADMIN', 'MODERATOR')
  @ApiOperation({
    summary: 'Recent pending reports (right sidebar)',
    description:
      'Returns the most recent unresolved (`PENDING`) member reports for this community, ordered by `reportedAt DESC`. ' +
      'Use this to populate the Recent Reports sidebar. Default limit is 10, max 50.',
  })
  @ApiParam(COMMUNITY_ID_PARAM)
  @ApiQuery({ name: 'limit', required: false, description: 'Max number of reports to return (1–50). Defaults to 10.', example: 10 })
  @ApiOkResponse({ description: 'List of pending reports with post snippet and reporter info.', schema: { example: RECENT_REPORTS_EXAMPLE } })
  getRecentReports(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? Math.min(parseInt(limit, 10) || 10, 50) : 10;
    return this.service.getRecentReports(communityId, parsedLimit);
  }

  // ─── Report Actions ─────────────────────────────────────────────────────────

  @Patch('reports/:reportId/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resolve a report',
    description:
      'Marks the report as `RESOLVED` (admin took action — e.g. deleted the post or warned the member). ' +
      'Records `resolvedBy` (admin user ID) and `resolvedAt`. Audit-logged as `FEED_POST_REPORT_RESOLVED`.',
  })
  @ApiParam(COMMUNITY_ID_PARAM)
  @ApiParam({ name: 'reportId', description: 'UUID of the report to resolve.', example: 'r1a2b3c4-d5e6-7890-abcd-ef1234567890' })
  @ApiOkResponse({ schema: { example: RESOLVE_REPORT_EXAMPLE } })
  @ApiNotFoundResponse({ description: 'Report not found.' })
  resolveReport(
    @Param('communityId', ParseUUIDPipe) _communityId: string,
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @GetUser('id') actorId: string,
  ) {
    return this.service.resolveReport(reportId, actorId);
  }

  @Patch('reports/:reportId/dismiss')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Dismiss a report',
    description:
      'Marks the report as `DISMISSED` (admin reviewed and found the report unwarranted). ' +
      'Records `resolvedBy` and `resolvedAt`. Audit-logged as `FEED_POST_REPORT_DISMISSED`.',
  })
  @ApiParam(COMMUNITY_ID_PARAM)
  @ApiParam({ name: 'reportId', description: 'UUID of the report to dismiss.', example: 'r1a2b3c4-d5e6-7890-abcd-ef1234567890' })
  @ApiOkResponse({ schema: { example: DISMISS_REPORT_EXAMPLE } })
  @ApiNotFoundResponse({ description: 'Report not found.' })
  dismissReport(
    @Param('communityId', ParseUUIDPipe) _communityId: string,
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @GetUser('id') actorId: string,
  ) {
    return this.service.dismissReport(reportId, actorId);
  }
}
