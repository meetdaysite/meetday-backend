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
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CommunityAnnouncementsService } from './community-announcements.service';
import { AdminListAnnouncementsQueryDto } from './dto/admin-list-announcements-query.dto';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';

// ─── Shared response shape examples ──────────────────────────────────────────

const ANNOUNCEMENT_PUBLISHED_EXAMPLE = {
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
};

const ANNOUNCEMENT_SCHEDULED_EXAMPLE = {
  ...ANNOUNCEMENT_PUBLISHED_EXAMPLE,
  status: 'SCHEDULED',
  scheduledAt: '2026-07-01T10:00:00.000Z',
  publishedAt: null,
  reachCount: 0,
  likeCount: 0,
  bookmarkCount: 0,
  title: 'Sunset Sessions This Weekend',
  body: 'We\'re back with another amazing sunset session. See you there!',
  imageKey: 'announcements/sunset-sessions-b2c3d4e5.jpg',
  imageUrl: 'https://storage.googleapis.com/meetday-media/announcements/sunset-sessions-b2c3d4e5.jpg?X-Goog-Signature=...',
};

const ANNOUNCEMENT_DRAFT_EXAMPLE = {
  ...ANNOUNCEMENT_PUBLISHED_EXAMPLE,
  status: 'DRAFT',
  scheduledAt: null,
  publishedAt: null,
  reachCount: 0,
  likeCount: 0,
  bookmarkCount: 0,
  title: 'Community Guidelines Reminder',
  body: 'A quick reminder to keep our community safe, respectful and positive for everyone.',
  imageKey: null,
  imageUrl: null,
};

const wrapData = (data: unknown) => ({
  success: true,
  timestamp: '2026-06-26T10:00:00.000Z',
  data,
});

// ─────────────────────────────────────────────────────────────────────────────

@ApiTags('Community Announcements (Admin)')
@ApiBearerAuth('firebase-token')
@UseGuards(RolesGuard)
@Roles('SUPER_ADMIN', 'CITY_ADMIN')
@ApiForbiddenResponse({
  description: 'Caller does not hold a `SUPER_ADMIN` or `CITY_ADMIN` role.',
  schema: {
    example: wrapData({ message: 'Forbidden resource', error: 'Forbidden', statusCode: 403 }),
  },
})
@Controller('admin/communities/:communityId/announcements')
export class CommunityAnnouncementsAdminController {
  constructor(private readonly service: CommunityAnnouncementsService) {}

  // ─── List ──────────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'List announcements (admin)',
    description:
      'Returns a paginated list of announcements for the given community. ' +
      'Unlike the member-facing feed, this endpoint:\n\n' +
      '- Returns **all statuses** (`PUBLISHED`, `SCHEDULED`, `DRAFT`) unless `status` is supplied.\n' +
      '- Uses **offset-based pagination** (page / limit) so the admin UI can render numbered page buttons.\n' +
      '- Is ordered by `createdAt DESC` (newest first, regardless of publish time).\n' +
      '- Soft-deleted announcements (`deletedAt != null`) are always excluded.\n\n' +
      'Call `GET /stats` first to populate the summary cards (published count, scheduled count, drafts, total reach).',
  })
  @ApiParam({
    name: 'communityId',
    description: 'UUID of the community whose announcements you want to manage.',
    example: 'c1d2e3f4-a5b6-7890-cdef-012345678901',
  })
  @ApiOkResponse({
    description:
      'Paginated list of announcements. `items` may mix statuses when no `status` filter is applied.',
    schema: {
      example: wrapData({
        items: [ANNOUNCEMENT_PUBLISHED_EXAMPLE, ANNOUNCEMENT_SCHEDULED_EXAMPLE, ANNOUNCEMENT_DRAFT_EXAMPLE],
        total: 32,
        page: 1,
        limit: 10,
        totalPages: 4,
      }),
    },
  })
  list(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Query() query: AdminListAnnouncementsQueryDto,
  ) {
    return this.service.listAdmin(communityId, query);
  }

  // ─── Stats ─────────────────────────────────────────────────────────────────

  @Get('stats')
  @ApiOperation({
    summary: 'Announcement summary stats',
    description:
      'Returns the four summary cards shown at the top of the admin announcements tab:\n\n' +
      '| Field | Description |\n' +
      '|---|---|\n' +
      '| `published` | Count of non-deleted `PUBLISHED` announcements. |\n' +
      '| `scheduled` | Count of non-deleted `SCHEDULED` announcements (queued, not yet sent). |\n' +
      '| `drafts` | Count of non-deleted `DRAFT` announcements. |\n' +
      '| `totalReach.value` | Sum of `reachCount` across all `PUBLISHED` announcements whose `publishedAt` falls in the last 7 days. |\n' +
      '| `totalReach.changePercent` | Percentage change vs the prior 7-day window. `null` when there is no prior-window data. |\n\n' +
      'Call this endpoint once on page load alongside `GET /` to hydrate both the cards and the list in a single round-trip.',
  })
  @ApiParam({
    name: 'communityId',
    description: 'UUID of the community.',
    example: 'c1d2e3f4-a5b6-7890-cdef-012345678901',
  })
  @ApiOkResponse({
    description: 'Summary counts and 7-day total reach with week-over-week change.',
    schema: {
      example: wrapData({
        published: 24,
        scheduled: 3,
        drafts: 5,
        totalReach: {
          value: 18200,
          changePercent: 24,
          windowDays: 7,
        },
      }),
    },
  })
  stats(@Param('communityId', ParseUUIDPipe) communityId: string) {
    return this.service.adminStats(communityId);
  }

  // ─── Create ────────────────────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an announcement',
    description:
      'Creates an announcement and, depending on `status`, triggers the notification fan-out:\n\n' +
      '**`PUBLISHED` (default)**\n' +
      'Fan-out runs immediately in the background (Bull queue). ' +
      'All active community members except the author receive an in-app notification. ' +
      '`reachCount` is updated once the job completes — it will be `0` in the immediate response.\n\n' +
      '**`SCHEDULED`**\n' +
      'A delayed Bull job is enqueued. Fan-out fires at `scheduledAt`. ' +
      'The announcement transitions to `PUBLISHED` automatically and `publishedAt` is set at that point. ' +
      '`scheduledAt` is **required** and must be a future ISO 8601 datetime.\n\n' +
      '**`DRAFT`**\n' +
      'Saved without any notification. Use `PATCH /:id` to update content or change `status` to publish it.',
  })
  @ApiParam({
    name: 'communityId',
    description: 'UUID of the community this announcement belongs to.',
    example: 'c1d2e3f4-a5b6-7890-cdef-012345678901',
  })
  @ApiCreatedResponse({
    description: 'Announcement created. The fan-out may still be in progress for `PUBLISHED` announcements.',
    schema: {
      examples: {
        published: {
          summary: 'status=PUBLISHED — sent immediately',
          value: wrapData(ANNOUNCEMENT_PUBLISHED_EXAMPLE),
        },
        scheduled: {
          summary: 'status=SCHEDULED — queued for future delivery',
          value: wrapData(ANNOUNCEMENT_SCHEDULED_EXAMPLE),
        },
        draft: {
          summary: 'status=DRAFT — saved, not sent',
          value: wrapData(ANNOUNCEMENT_DRAFT_EXAMPLE),
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      '`status` is `SCHEDULED` but `scheduledAt` is missing or not a valid ISO 8601 datetime. ' +
      'Also returned when any required field fails validation (e.g. title too short, body too long).',
    schema: {
      example: wrapData({
        message: ['scheduledAt must be a valid ISO 8601 date string'],
        error: 'Bad Request',
        statusCode: 400,
      }),
    },
  })
  @ApiNotFoundResponse({
    description: 'No community with the given `communityId` exists (or it has been deleted).',
    schema: {
      example: wrapData({ message: 'Community not found', error: 'Not Found', statusCode: 404 }),
    },
  })
  create(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser('id') adminId: string,
    @Body() dto: CreateAnnouncementDto,
  ) {
    return this.service.create(communityId, adminId, dto);
  }

  // ─── Update ────────────────────────────────────────────────────────────────

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit an announcement',
    description:
      'Partial update — send only the fields you want to change. ' +
      'All fields from `CreateAnnouncementDto` are accepted (all optional here).\n\n' +
      '**Important constraints:**\n' +
      '- Changing `status` from `DRAFT` or `SCHEDULED` to `PUBLISHED` via this endpoint does ' +
      '**not** trigger a fan-out. Use `POST /` with `status=PUBLISHED` to create a new announcement ' +
      'that fans out, or implement a dedicated publish endpoint if needed.\n' +
      '- Editing a `PUBLISHED` announcement does **not** re-notify members.',
  })
  @ApiParam({
    name: 'communityId',
    description: 'UUID of the community.',
    example: 'c1d2e3f4-a5b6-7890-cdef-012345678901',
  })
  @ApiParam({
    name: 'id',
    description: 'UUID of the announcement to edit.',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiOkResponse({
    description: 'Updated announcement.',
    schema: {
      example: wrapData({
        ...ANNOUNCEMENT_PUBLISHED_EXAMPLE,
        title: 'Night Rituals — Doors Open at 9 PM',
        updatedAt: '2026-06-26T12:30:00.000Z',
      }),
    },
  })
  @ApiNotFoundResponse({
    description: 'Announcement not found in this community or has been soft-deleted.',
    schema: {
      example: wrapData({ message: 'Announcement not found', error: 'Not Found', statusCode: 404 }),
    },
  })
  update(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') adminId: string,
    @Body() dto: UpdateAnnouncementDto,
  ) {
    return this.service.update(communityId, id, dto, adminId);
  }

  // ─── Delete ────────────────────────────────────────────────────────────────

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Soft-delete an announcement',
    description:
      'Sets `deletedAt` to now. The announcement is immediately hidden from the member feed ' +
      'and from the admin list. This action is not reversible via the API. ' +
      'The record is retained in the database for audit purposes.',
  })
  @ApiParam({
    name: 'communityId',
    description: 'UUID of the community.',
    example: 'c1d2e3f4-a5b6-7890-cdef-012345678901',
  })
  @ApiParam({
    name: 'id',
    description: 'UUID of the announcement to delete.',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiOkResponse({
    description: 'Announcement soft-deleted.',
    schema: { example: wrapData({ success: true }) },
  })
  @ApiNotFoundResponse({
    description: 'Announcement not found in this community or already deleted.',
    schema: {
      example: wrapData({ message: 'Announcement not found', error: 'Not Found', statusCode: 404 }),
    },
  })
  remove(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') adminId: string,
  ) {
    return this.service.softDelete(communityId, id, adminId);
  }

  // ─── Pin ───────────────────────────────────────────────────────────────────

  @Post(':id/pin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Pin an announcement',
    description:
      'Marks the announcement as pinned. Pinned announcements are always shown at the top ' +
      'of the member feed on the first page, sorted by `pinnedAt DESC` (most recently pinned first). ' +
      'There is no hard limit on the number of pinned announcements, but pinning too many degrades ' +
      'the feed experience — keep it to 1–2.',
  })
  @ApiParam({
    name: 'communityId',
    description: 'UUID of the community.',
    example: 'c1d2e3f4-a5b6-7890-cdef-012345678901',
  })
  @ApiParam({
    name: 'id',
    description: 'UUID of the announcement to pin.',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiOkResponse({
    description: 'Announcement pinned.',
    schema: {
      example: wrapData({
        ...ANNOUNCEMENT_PUBLISHED_EXAMPLE,
        isPinned: true,
        pinnedAt: '2026-06-26T11:00:00.000Z',
      }),
    },
  })
  @ApiNotFoundResponse({
    description: 'Announcement not found in this community or has been soft-deleted.',
    schema: {
      example: wrapData({ message: 'Announcement not found', error: 'Not Found', statusCode: 404 }),
    },
  })
  pin(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') adminId: string,
  ) {
    return this.service.pin(communityId, id, adminId);
  }

  // ─── Unpin ─────────────────────────────────────────────────────────────────

  @Delete(':id/pin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Unpin an announcement',
    description:
      'Clears the pin. The announcement re-enters the regular chronological feed ' +
      'at its original `publishedAt` position.',
  })
  @ApiParam({
    name: 'communityId',
    description: 'UUID of the community.',
    example: 'c1d2e3f4-a5b6-7890-cdef-012345678901',
  })
  @ApiParam({
    name: 'id',
    description: 'UUID of the announcement to unpin.',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiOkResponse({
    description: 'Announcement unpinned.',
    schema: {
      example: wrapData({
        ...ANNOUNCEMENT_PUBLISHED_EXAMPLE,
        isPinned: false,
        pinnedAt: null,
      }),
    },
  })
  @ApiNotFoundResponse({
    description: 'Announcement not found in this community or has been soft-deleted.',
    schema: {
      example: wrapData({ message: 'Announcement not found', error: 'Not Found', statusCode: 404 }),
    },
  })
  unpin(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') adminId: string,
  ) {
    return this.service.unpin(communityId, id, adminId);
  }
}
