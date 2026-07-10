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

const EXAMPLE = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  communityId: 'c1d2e3f4-a5b6-7890-cdef-012345678901',
  authorId: 'u1v2w3x4-y5z6-7890-abcd-ef1234567890',
  authorRole: 'HOST',
  category: 'EVENT_DROP',
  title: 'Sunset Rooftop Party — This Saturday!',
  body: 'Join us for deep house vibes and city views at Skydeck, Bangalore. Doors open at 6 PM.',
  imageKey: null,
  imageUrl: null,
  status: 'PUBLISHED',
  scheduledAt: null,
  isPinned: false,
  pinnedAt: null,
  likeCount: 12,
  bookmarkCount: 4,
  reachCount: 340,
  publishedAt: '2026-06-27T08:00:00.000Z',
  deletedAt: null,
  createdAt: '2026-06-27T07:55:00.000Z',
  updatedAt: '2026-06-27T08:00:00.000Z',
  author: {
    id: 'u1v2w3x4-y5z6-7890-abcd-ef1234567890',
    name: 'Rahul Sharma',
    avatarUrl: 'https://cdn.example.com/signed/avatar.jpg',
    isBrand: false,
  },
  likedByMe: false,
  bookmarkedByMe: false,
};

const wrapData = (data: unknown) => ({
  success: true,
  timestamp: '2026-06-27T08:00:00.000Z',
  data,
});

@ApiTags('Community Announcements (Host)')
@ApiBearerAuth('firebase-token')
@UseGuards(RolesGuard)
@Roles('HOST')
@ApiForbiddenResponse({
  description: 'Caller does not hold a `HOST` role.',
  schema: { example: wrapData({ message: 'Forbidden resource', error: 'Forbidden', statusCode: 403 }) },
})
@Controller('communities/:communityId/host/announcements')
export class CommunityAnnouncementsHostController {
  constructor(private readonly service: CommunityAnnouncementsService) {}

  // ─── List own announcements ────────────────────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'List own announcements (host)',
    description:
      'Returns the calling host\'s announcements for this community using **offset pagination**.\n\n' +
      'Unlike the member feed, this returns **all statuses** (`PUBLISHED`, `SCHEDULED`, `DRAFT`) ' +
      'so the host can manage drafts and see upcoming scheduled items. Filter by `status` to isolate a view.\n\n' +
      'Only the calling host\'s own announcements are returned — admin- or other-host-authored announcements are excluded.',
  })
  @ApiParam({ name: 'communityId', description: 'UUID of the community.', example: 'c1d2e3f4-a5b6-7890-cdef-012345678901' })
  @ApiOkResponse({
    description: 'Paginated list of the host\'s own announcements.',
    schema: {
      example: wrapData({
        items: [EXAMPLE],
        total: 8,
        page: 1,
        limit: 10,
        totalPages: 1,
      }),
    },
  })
  list(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser('id') hostId: string,
    @Query() query: AdminListAnnouncementsQueryDto,
  ) {
    return this.service.listForHost(communityId, hostId, query);
  }

  // ─── Stats ─────────────────────────────────────────────────────────────────

  @Get('stats')
  @ApiOperation({
    summary: 'Announcement stats for the host',
    description:
      'Returns summary cards scoped to the calling host\'s own announcements in this community:\n\n' +
      '| Field | Description |\n' +
      '|---|---|\n' +
      '| `published` | Count of own non-deleted `PUBLISHED` announcements. |\n' +
      '| `scheduled` | Count of own non-deleted `SCHEDULED` announcements. |\n' +
      '| `drafts` | Count of own non-deleted `DRAFT` announcements. |\n' +
      '| `totalReach.value` | Sum of `reachCount` for own `PUBLISHED` announcements in the last 7 days. |\n' +
      '| `totalReach.changePercent` | Week-over-week change. `null` when there is no prior-week data. |',
  })
  @ApiParam({ name: 'communityId', description: 'UUID of the community.', example: 'c1d2e3f4-a5b6-7890-cdef-012345678901' })
  @ApiOkResponse({
    description: 'Summary stats for the host\'s own announcements.',
    schema: {
      example: wrapData({
        published: 5,
        scheduled: 1,
        drafts: 2,
        totalReach: { value: 3200, changePercent: 15, windowDays: 7 },
      }),
    },
  })
  stats(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser('id') hostId: string,
  ) {
    return this.service.hostStats(communityId, hostId);
  }

  // ─── Create ────────────────────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an announcement',
    description:
      'Creates an announcement authored under the calling host\'s identity (`authorRole: "HOST"`).\n\n' +
      '**`PUBLISHED` (default)** — fan-out fires immediately. All active community members receive an in-app notification.\n\n' +
      '**`SCHEDULED`** — fan-out fires at `scheduledAt` (must be a future ISO 8601 datetime).\n\n' +
      '**`DRAFT`** — saved without sending any notification. Update via `PATCH /:id`.',
  })
  @ApiParam({ name: 'communityId', description: 'UUID of the community.', example: 'c1d2e3f4-a5b6-7890-cdef-012345678901' })
  @ApiCreatedResponse({
    description: 'Announcement created.',
    schema: { example: wrapData(EXAMPLE) },
  })
  @ApiNotFoundResponse({
    description: 'Community not found.',
    schema: { example: wrapData({ message: 'Community not found', error: 'Not Found', statusCode: 404 }) },
  })
  create(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser('id') hostId: string,
    @Body() dto: CreateAnnouncementDto,
  ) {
    return this.service.createAsHost(communityId, hostId, dto);
  }

  // ─── Update ────────────────────────────────────────────────────────────────

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit own announcement',
    description:
      'Partial update — send only the fields you want to change. ' +
      'Returns 403 if the announcement was authored by someone else. ' +
      'Editing a `PUBLISHED` announcement does **not** re-notify members.',
  })
  @ApiParam({ name: 'communityId', example: 'c1d2e3f4-a5b6-7890-cdef-012345678901' })
  @ApiParam({ name: 'id', description: 'UUID of the announcement to edit.', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @ApiOkResponse({
    description: 'Updated announcement.',
    schema: { example: wrapData({ ...EXAMPLE, title: 'Sunset Rooftop Party — Doors open at 5:30 PM!' }) },
  })
  @ApiNotFoundResponse({
    description: 'Announcement not found.',
    schema: { example: wrapData({ message: 'Announcement not found', error: 'Not Found', statusCode: 404 }) },
  })
  update(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') hostId: string,
    @Body() dto: UpdateAnnouncementDto,
  ) {
    return this.service.updateAsHost(communityId, id, hostId, dto);
  }

  // ─── Delete ────────────────────────────────────────────────────────────────

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Soft-delete own announcement',
    description:
      'Sets `deletedAt` to now. Immediately hidden from the member feed. ' +
      'Returns 403 if the announcement was authored by someone else.',
  })
  @ApiParam({ name: 'communityId', example: 'c1d2e3f4-a5b6-7890-cdef-012345678901' })
  @ApiParam({ name: 'id', description: 'UUID of the announcement to delete.', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @ApiOkResponse({ schema: { example: wrapData({ success: true }) } })
  @ApiNotFoundResponse({
    schema: { example: wrapData({ message: 'Announcement not found', error: 'Not Found', statusCode: 404 }) },
  })
  remove(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') hostId: string,
  ) {
    return this.service.softDeleteAsHost(communityId, id, hostId);
  }

  // ─── Pin ───────────────────────────────────────────────────────────────────

  @Post(':id/pin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Pin own announcement',
    description:
      'Marks the announcement as pinned so it appears at the top of the member feed on the first page. ' +
      'Returns 403 if the announcement was authored by someone else.',
  })
  @ApiParam({ name: 'communityId', example: 'c1d2e3f4-a5b6-7890-cdef-012345678901' })
  @ApiParam({ name: 'id', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @ApiOkResponse({ schema: { example: wrapData({ ...EXAMPLE, isPinned: true, pinnedAt: '2026-06-27T09:00:00.000Z' }) } })
  @ApiNotFoundResponse({
    schema: { example: wrapData({ message: 'Announcement not found', error: 'Not Found', statusCode: 404 }) },
  })
  pin(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') hostId: string,
  ) {
    return this.service.pinAsHost(communityId, id, hostId);
  }

  // ─── Unpin ─────────────────────────────────────────────────────────────────

  @Delete(':id/pin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Unpin own announcement',
    description:
      'Clears the pin. The announcement re-enters the regular chronological feed. ' +
      'Returns 403 if the announcement was authored by someone else.',
  })
  @ApiParam({ name: 'communityId', example: 'c1d2e3f4-a5b6-7890-cdef-012345678901' })
  @ApiParam({ name: 'id', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @ApiOkResponse({ schema: { example: wrapData({ ...EXAMPLE, isPinned: false, pinnedAt: null }) } })
  @ApiNotFoundResponse({
    schema: { example: wrapData({ message: 'Announcement not found', error: 'Not Found', statusCode: 404 }) },
  })
  unpin(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') hostId: string,
  ) {
    return this.service.unpinAsHost(communityId, id, hostId);
  }
}
