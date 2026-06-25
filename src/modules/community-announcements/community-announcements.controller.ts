import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CommunityRole } from '@prisma/client';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { MinCommunityRole } from '../../common/decorators/min-community-role.decorator';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { CommunityRoleGuard } from '../../common/guards/community-role.guard';
import { CommunityAnnouncementsService } from './community-announcements.service';
import { ListAnnouncementsQueryDto } from './dto/list-announcements-query.dto';

// ─── Shared example shapes ────────────────────────────────────────────────────

const ANNOUNCEMENT_ITEM_EXAMPLE = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  communityId: 'c1d2e3f4-a5b6-7890-cdef-012345678901',
  authorId: 'u1v2w3x4-y5z6-7890-abcd-ef1234567890',
  authorRole: 'ADMIN',
  category: 'EVENT_DROP',
  title: 'Night Rituals Early Access',
  body: 'Get early access to Night Rituals before anyone else. Limited passes. Don\'t miss out!',
  imageKey: 'announcements/night-rituals-a1b2c3d4.jpg',
  imageUrl: 'https://storage.googleapis.com/meetday-media/announcements/night-rituals-a1b2c3d4.jpg?X-Goog-Signature=...',
  status: 'PUBLISHED',
  scheduledAt: null,
  isPinned: false,
  pinnedAt: null,
  likeCount: 47,
  bookmarkCount: 12,
  reachCount: 820,
  publishedAt: '2026-06-26T10:00:00.000Z',
  deletedAt: null,
  createdAt: '2026-06-26T09:55:00.000Z',
  updatedAt: '2026-06-26T10:00:00.000Z',
  author: {
    id: 'u1v2w3x4-y5z6-7890-abcd-ef1234567890',
    name: 'Meetday Team',
    avatarUrl: null,
    isBrand: true,
  },
  likedByMe: false,
  bookmarkedByMe: false,
};

const wrapData = (data: unknown) => ({
  success: true,
  timestamp: '2026-06-26T10:00:00.000Z',
  data,
});

// ─────────────────────────────────────────────────────────────────────────────

@ApiTags('Community Announcements')
@ApiBearerAuth('firebase-token')
@UseGuards(FirebaseAuthGuard, CommunityRoleGuard)
@MinCommunityRole(CommunityRole.MEMBER)
@ApiForbiddenResponse({
  description:
    'The authenticated user is not a member of this community, or announcements have been ' +
    'disabled in the community settings.',
  schema: {
    example: wrapData({ message: 'Forbidden resource', error: 'Forbidden', statusCode: 403 }),
  },
})
@Controller('communities/:communityId/announcements')
export class CommunityAnnouncementsController {
  constructor(private readonly service: CommunityAnnouncementsService) {}

  // ─── Feed ──────────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'List announcements (member feed)',
    description:
      'Returns the announcement feed for a community member using **cursor-based pagination**.\n\n' +
      '**Page 1** (no `cursor`): pinned announcements are prepended in `pinnedAt DESC` order, ' +
      'followed by non-pinned announcements in `publishedAt DESC` order.\n\n' +
      '**Subsequent pages** (pass `cursor`): only non-pinned announcements starting from the ' +
      'cursor point. Pinned items are not repeated.\n\n' +
      'Only `PUBLISHED` announcements are returned — drafts and scheduled items are never visible here.\n\n' +
      'Use `nextCursor` from the response to fetch the next page. When `nextCursor` is `null`, ' +
      'you have reached the end of the feed.',
  })
  @ApiParam({
    name: 'communityId',
    description: 'UUID of the community.',
    example: 'c1d2e3f4-a5b6-7890-cdef-012345678901',
  })
  @ApiOkResponse({
    description: 'Announcement feed page with cursor for the next page.',
    schema: {
      examples: {
        firstPage: {
          summary: 'First page (no cursor) — pinned item at top',
          value: wrapData({
            items: [
              { ...ANNOUNCEMENT_ITEM_EXAMPLE, isPinned: true, pinnedAt: '2026-06-25T08:00:00.000Z' },
              ANNOUNCEMENT_ITEM_EXAMPLE,
            ],
            nextCursor: '2026-06-24T10:00:00.000Z',
          }),
        },
        lastPage: {
          summary: 'Last page — nextCursor is null',
          value: wrapData({
            items: [
              {
                ...ANNOUNCEMENT_ITEM_EXAMPLE,
                id: 'f0e9d8c7-b6a5-4321-fedc-ba9876543210',
                title: 'Welcome to Meetday Music Nights!',
                publishedAt: '2026-05-25T09:00:00.000Z',
                likedByMe: true,
                bookmarkedByMe: true,
              },
            ],
            nextCursor: null,
          }),
        },
      },
    },
  })
  list(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser('dbUserId') userId: string,
    @Query() query: ListAnnouncementsQueryDto,
  ) {
    return this.service.list(communityId, userId, query.cursor, query.limit);
  }

  // ─── Unread count ──────────────────────────────────────────────────────────

  @Get('unread-count')
  @ApiOperation({
    summary: 'Unread announcement count (notification badge)',
    description:
      'Returns the number of published announcements posted since the member last called ' +
      '`POST /mark-read`. Use this to drive the unread badge on the announcements tab icon.\n\n' +
      'Announcements authored by the requesting user are excluded from the count. ' +
      'If the member has never read announcements, all published announcements in the community count as unread.',
  })
  @ApiParam({
    name: 'communityId',
    description: 'UUID of the community.',
    example: 'c1d2e3f4-a5b6-7890-cdef-012345678901',
  })
  @ApiOkResponse({
    description: 'Unread count. Render a badge when `count > 0`.',
    schema: {
      examples: {
        unread: {
          summary: 'Has unread announcements',
          value: wrapData({ count: 3 }),
        },
        allRead: {
          summary: 'All caught up',
          value: wrapData({ count: 0 }),
        },
      },
    },
  })
  unreadCount(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser('dbUserId') userId: string,
  ) {
    return this.service.getUnreadCount(communityId, userId);
  }

  // ─── Mark read ─────────────────────────────────────────────────────────────

  @Post('mark-read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark all announcements as read',
    description:
      'Sets `lastReadAnnouncementsAt` to now for the requesting member, which resets the unread badge to 0. ' +
      'Call this when the user opens the announcements tab or scrolls through the feed. ' +
      'This does not track per-announcement read state — it is a single watermark per member.',
  })
  @ApiParam({
    name: 'communityId',
    description: 'UUID of the community.',
    example: 'c1d2e3f4-a5b6-7890-cdef-012345678901',
  })
  @ApiOkResponse({
    description: 'Watermark updated. Subsequent calls to `GET /unread-count` will return `0`.',
    schema: { example: wrapData({ success: true }) },
  })
  markRead(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser('dbUserId') userId: string,
  ) {
    return this.service.markRead(communityId, userId);
  }

  // ─── Bookmarks ─────────────────────────────────────────────────────────────

  @Get('bookmarks')
  @ApiOperation({
    summary: 'List saved (bookmarked) announcements',
    description:
      'Returns all announcements the requesting member has bookmarked in this community, ' +
      'ordered by `bookmarkedAt DESC` (most recently saved first). ' +
      'Deleted announcements are automatically excluded.',
  })
  @ApiParam({
    name: 'communityId',
    description: 'UUID of the community.',
    example: 'c1d2e3f4-a5b6-7890-cdef-012345678901',
  })
  @ApiOkResponse({
    description: 'Array of bookmarked announcements with `bookmarkedByMe: true` on every item.',
    schema: {
      example: wrapData([
        { ...ANNOUNCEMENT_ITEM_EXAMPLE, bookmarkedByMe: true },
      ]),
    },
  })
  bookmarks(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser('dbUserId') userId: string,
  ) {
    return this.service.listBookmarks(communityId, userId);
  }

  // ─── Likes ─────────────────────────────────────────────────────────────────

  @Post(':id/like')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Like an announcement',
    description:
      'Increments `likeCount` and records the like for the requesting user. ' +
      'Idempotent — calling this when the user has already liked the announcement is a safe no-op.',
  })
  @ApiParam({ name: 'communityId', example: 'c1d2e3f4-a5b6-7890-cdef-012345678901' })
  @ApiParam({ name: 'id', description: 'UUID of the announcement to like.', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @ApiOkResponse({
    schema: { example: wrapData({ success: true }) },
  })
  @ApiNotFoundResponse({
    description: 'Announcement not found or deleted.',
    schema: {
      example: wrapData({ message: 'Announcement not found', error: 'Not Found', statusCode: 404 }),
    },
  })
  like(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('dbUserId') userId: string,
  ) {
    return this.service.like(communityId, id, userId);
  }

  @Delete(':id/like')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remove a like',
    description:
      'Decrements `likeCount` and removes the like record. ' +
      'Idempotent — calling this when the user has not liked the announcement is a safe no-op.',
  })
  @ApiParam({ name: 'communityId', example: 'c1d2e3f4-a5b6-7890-cdef-012345678901' })
  @ApiParam({ name: 'id', description: 'UUID of the announcement to unlike.', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @ApiOkResponse({
    schema: { example: wrapData({ success: true }) },
  })
  @ApiNotFoundResponse({
    description: 'Announcement not found or deleted.',
    schema: {
      example: wrapData({ message: 'Announcement not found', error: 'Not Found', statusCode: 404 }),
    },
  })
  unlike(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('dbUserId') userId: string,
  ) {
    return this.service.unlike(communityId, id, userId);
  }

  // ─── Bookmark mutations ────────────────────────────────────────────────────

  @Post(':id/bookmark')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Bookmark an announcement',
    description:
      'Saves the announcement to the member\'s bookmarks and increments `bookmarkCount`. ' +
      'Idempotent — safe to call even if already bookmarked.',
  })
  @ApiParam({ name: 'communityId', example: 'c1d2e3f4-a5b6-7890-cdef-012345678901' })
  @ApiParam({ name: 'id', description: 'UUID of the announcement to bookmark.', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @ApiOkResponse({
    schema: { example: wrapData({ success: true }) },
  })
  @ApiNotFoundResponse({
    description: 'Announcement not found or deleted.',
    schema: {
      example: wrapData({ message: 'Announcement not found', error: 'Not Found', statusCode: 404 }),
    },
  })
  bookmark(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('dbUserId') userId: string,
  ) {
    return this.service.bookmark(communityId, id, userId);
  }

  @Delete(':id/bookmark')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remove a bookmark',
    description:
      'Removes the announcement from the member\'s bookmarks and decrements `bookmarkCount`. ' +
      'Idempotent — safe to call even if not bookmarked.',
  })
  @ApiParam({ name: 'communityId', example: 'c1d2e3f4-a5b6-7890-cdef-012345678901' })
  @ApiParam({ name: 'id', description: 'UUID of the announcement to unbookmark.', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @ApiOkResponse({
    schema: { example: wrapData({ success: true }) },
  })
  @ApiNotFoundResponse({
    description: 'Announcement not found or deleted.',
    schema: {
      example: wrapData({ message: 'Announcement not found', error: 'Not Found', statusCode: 404 }),
    },
  })
  unbookmark(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('dbUserId') userId: string,
  ) {
    return this.service.unbookmark(communityId, id, userId);
  }
}
