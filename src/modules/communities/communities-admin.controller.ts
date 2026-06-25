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
  Put,
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
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { CommunitiesService } from './communities.service';
import { CommunityOverviewService } from './community-overview.service';
import { CreateCommunityDto } from './dto/create-community.dto';
import { UpdateCommunityDto } from './dto/update-community.dto';
import { UpdateCommunitySettingsDto } from './dto/update-community-settings.dto';
import { SetCommunityInterestsDto } from './dto/set-community-interests.dto';
import { SetCommunityCitiesDto } from './dto/set-community-cities.dto';
import { AssignMemberDto } from './dto/assign-member.dto';
import { AddCommunityEventDto } from './dto/add-community-event.dto';
import { ListCommunitiesQueryDto } from './dto/list-communities-query.dto';

// ─── Shared example helpers ──────────────────────────────────────────────────

const wrapData = (data: unknown) => ({
  success: true,
  timestamp: '2026-06-26T10:00:00.000Z',
  data,
});

const COMMUNITY_EXAMPLE = {
  id: 'c1d2e3f4-a5b6-7890-cdef-012345678901',
  name: 'Meetday Music Nights',
  slug: 'meetday-music-nights',
  type: 'MEETDAY_MANAGED_PUBLIC',
  status: 'PUBLISHED',
  access: 'PUBLIC',
  description: 'A community for music lovers, live performance regulars, and people who enjoy real-world experiences.',
  iconUrl: 'https://storage.googleapis.com/meetday-media/communities/icon-c1d2e3f4.jpg?X-Goog-Signature=...',
  coverUrl: 'https://storage.googleapis.com/meetday-media/communities/cover-c1d2e3f4.jpg?X-Goog-Signature=...',
  memberCount: 1248,
  createdAt: '2024-05-25T00:00:00.000Z',
  url: 'meetday.ai/communities/meetday-music-nights',
};

const SPARKLINE_14 = [8, 12, 5, 19, 14, 7, 22, 18, 11, 25, 9, 16, 20, 47];

const OVERVIEW_EXAMPLE = {
  community: COMMUNITY_EXAMPLE,
  stats: {
    totalMembers: { value: 1248, delta7d: 47, deltaPct: 18, sparkline: SPARKLINE_14 },
    activeExperiences: { value: 12, delta7d: 2, deltaPct: 20, sparkline: [0,1,0,0,2,0,1,0,0,0,1,2,0,2] },
    postReach7d: { value: 18600, delta7d: 3600, deltaPct: 24, sparkline: [820,1100,950,780,1200,1400,900,1050,1300,800,1150,950,1100,1400] },
    messages7d: { value: 342, delta7d: 37, deltaPct: 12, sparkline: [18,24,19,28,22,30,25,35,28,40,32,38,35,42] },
  },
  upcomingExperiences: [
    {
      id: 'e1f2a3b4-c5d6-7890-ef12-345678901234',
      title: 'Night Rituals',
      eventDate: '2026-05-31T14:30:00.000Z',
      city: 'Kolkata',
      coverUrl: 'https://storage.googleapis.com/meetday-media/events/night-rituals.jpg?X-Goog-Signature=...',
      attendeeCount: 320,
      avgRating: 4.8,
      isAutoMatched: true,
      matchScore: 98,
    },
    {
      id: 'f2a3b4c5-d6e7-8901-f234-567890123456',
      title: 'After Hours',
      eventDate: '2026-06-01T15:30:00.000Z',
      city: 'Kolkata',
      coverUrl: 'https://storage.googleapis.com/meetday-media/events/after-hours.jpg?X-Goog-Signature=...',
      attendeeCount: 280,
      avgRating: 4.7,
      isAutoMatched: true,
      matchScore: 95,
    },
    {
      id: 'a3b4c5d6-e7f8-9012-a345-678901234567',
      title: 'Sunset Sessions',
      eventDate: '2026-06-08T12:30:00.000Z',
      city: 'Kolkata',
      coverUrl: 'https://storage.googleapis.com/meetday-media/events/sunset-sessions.jpg?X-Goog-Signature=...',
      attendeeCount: 260,
      avgRating: 4.6,
      isAutoMatched: false,
      matchScore: null,
    },
  ],
  managers: [
    { userId: 'u1a2b3c4-d5e6-7890-ab12-cdef01234567', firstName: 'Arjun', lastName: 'Mehta', avatarUrl: 'https://storage.googleapis.com/...', role: 'OWNER' },
    { userId: 'u2b3c4d5-e6f7-8901-bc23-def012345678', firstName: 'Riya', lastName: 'Banerjee', avatarUrl: 'https://storage.googleapis.com/...', role: 'MANAGER' },
    { userId: 'u3c4d5e6-f7a8-9012-cd34-ef0123456789', firstName: 'Ishita', lastName: 'Dey', avatarUrl: null, role: 'MODERATOR' },
  ],
  recentActivity: [
    { type: 'MEMBER_JOINED', title: 'Rohit Sharma joined the community', actor: 'Rohit Sharma', at: '2026-06-26T09:58:00.000Z' },
    { type: 'EXPERIENCE_MATCHED', title: 'Tech House Night – Kolkata was added automatically', actor: null, at: '2026-06-26T09:45:00.000Z' },
    { type: 'NEW_POST', title: 'Vivek Rao posted in the community feed', actor: 'Vivek Rao', at: '2026-06-26T09:00:00.000Z' },
    { type: 'ANNOUNCEMENT_CREATED', title: 'Announcement: "Weekend Lineup Released!"', actor: null, at: '2026-06-26T07:00:00.000Z' },
  ],
  topEngagement7d: { posts: 128, comments: 96, reactions: 412, shares: 54, newMembers: 231 },
};

const MANAGER_EXAMPLE = [
  { userId: 'u1a2b3c4-d5e6-7890-ab12-cdef01234567', firstName: 'Arjun', lastName: 'Mehta', avatarUrl: 'https://storage.googleapis.com/...', role: 'OWNER' },
  { userId: 'u2b3c4d5-e6f7-8901-bc23-def012345678', firstName: 'Riya', lastName: 'Banerjee', avatarUrl: 'https://storage.googleapis.com/...', role: 'MANAGER' },
  { userId: 'u3c4d5e6-f7a8-9012-cd34-ef0123456789', firstName: 'Kabir', lastName: 'Shah', avatarUrl: 'https://storage.googleapis.com/...', role: 'MANAGER' },
  { userId: 'u4d5e6f7-a8b9-0123-de45-f01234567890', firstName: 'Ishita', lastName: 'Dey', avatarUrl: null, role: 'MODERATOR' },
  { userId: 'u5e6f7a8-b9c0-1234-ef56-012345678901', firstName: 'Manav', lastName: 'Sinha', avatarUrl: null, role: 'MODERATOR' },
];

// ─────────────────────────────────────────────────────────────────────────────

@ApiTags('Communities (Admin)')
@ApiBearerAuth('firebase-token')
@UseGuards(RolesGuard)
@Roles('SUPER_ADMIN', 'CITY_ADMIN')
@ApiForbiddenResponse({
  description: 'Caller does not hold a `SUPER_ADMIN` or `CITY_ADMIN` role.',
  schema: { example: wrapData({ message: 'Forbidden resource', error: 'Forbidden', statusCode: 403 }) },
})
@Controller('admin/communities')
export class CommunitiesAdminController {
  constructor(
    private readonly communitiesService: CommunitiesService,
    private readonly overviewService: CommunityOverviewService,
  ) {}

  // ─── List ──────────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'List communities (admin)',
    description:
      'Returns a paginated list of all communities. Supports filtering by `status`, `city`, ' +
      '`categoryId`, and free-text `search` on community name. ' +
      'Soft-deleted communities are always excluded.\n\n' +
      '**Status values:**\n' +
      '- `DRAFT` — being set up, not yet visible to members\n' +
      '- `PUBLISHED` — live and visible\n' +
      '- `ARCHIVED` — deactivated; no new members can join',
  })
  @ApiOkResponse({
    description: 'Paginated list of communities.',
    schema: {
      example: wrapData({
        items: [COMMUNITY_EXAMPLE],
        total: 42,
        page: 1,
        limit: 20,
        totalPages: 3,
      }),
    },
  })
  list(@Query() query: ListCommunitiesQueryDto) {
    return this.communitiesService.listForAdmin(query);
  }

  // ─── Overview ──────────────────────────────────────────────────────────────

  @Get(':id/overview')
  @ApiOperation({
    summary: 'Community overview dashboard',
    description:
      'Returns the complete data payload for the admin community overview tab. ' +
      'Results are cached in Redis for 60 seconds.\n\n' +
      '**Response sections:**\n\n' +
      '**`community`** — Metadata for the community header and status panel.\n' +
      '- `type`: `MEETDAY_MANAGED_PUBLIC` → render the "Meetday Managed" badge; ' +
      '`access: PUBLIC` → render the "Public Community" badge.\n' +
      '- `status`: `PUBLISHED` maps to "Active" in the UI.\n' +
      '- `url`: the public community link shown in the status panel.\n\n' +
      '**`stats`** — Four summary cards, each with:\n' +
      '- `value`: current total (members) or 7-day sum (reach, messages, experience adds).\n' +
      '- `delta7d`: absolute change in the last 7 days vs the prior 7-day window.\n' +
      '- `deltaPct`: percentage change (positive = growth, negative = decline).\n' +
      '- `sparkline`: 14-element array of daily counts, index 0 = 14 days ago, index 13 = today. ' +
      'Use this to render the mini trend line in each card.\n\n' +
      '**`upcomingExperiences`** — Up to 6 upcoming PUBLISHED events linked to this community, ' +
      'sorted by `eventDate` ascending. Each item includes:\n' +
      '- `isAutoMatched`: `true` if the event was auto-linked via the interest→category matching engine.\n' +
      '- `matchScore`: percentage (0–100) reflecting how many of the community\'s interests align with ' +
      'the event\'s category. `null` for manually-added events or when the community has no interests configured.\n\n' +
      '**`managers`** — Active members with roles OWNER, MANAGER, MODERATOR, or HOST. ' +
      'Ordered by role precedence (OWNER first).\n\n' +
      '**`recentActivity`** — 8 most recent events across 4 types: `MEMBER_JOINED`, ' +
      '`EXPERIENCE_MATCHED`, `NEW_POST`, `ANNOUNCEMENT_CREATED`. Sorted newest first.\n\n' +
      '**`topEngagement7d`** — Raw counts for the last 7 days. ' +
      'Render progress bars by scaling each value against the maximum across all 5 metrics.',
  })
  @ApiParam({
    name: 'id',
    description: 'UUID of the community.',
    example: 'c1d2e3f4-a5b6-7890-cdef-012345678901',
  })
  @ApiOkResponse({
    description: 'Full overview payload covering all 7 dashboard sections.',
    schema: { example: wrapData(OVERVIEW_EXAMPLE) },
  })
  @ApiNotFoundResponse({
    description: 'Community not found or has been deleted.',
    schema: {
      example: wrapData({ message: 'Community not found', error: 'Not Found', statusCode: 404 }),
    },
  })
  getOverview(@Param('id', ParseUUIDPipe) id: string) {
    return this.overviewService.getOverview(id);
  }

  // ─── Managers ──────────────────────────────────────────────────────────────

  @Get(':id/managers')
  @ApiOperation({
    summary: 'Managers & moderators',
    description:
      'Returns all active community members with a privileged role: ' +
      '**OWNER**, **MANAGER**, **MODERATOR**, or **HOST**. ' +
      'Results are ordered by role precedence (OWNER → MANAGER → MODERATOR → HOST). ' +
      'This endpoint is a subset of the `GET :id/overview` response — call the overview ' +
      'endpoint instead when you need the full dashboard payload.',
  })
  @ApiParam({
    name: 'id',
    description: 'UUID of the community.',
    example: 'c1d2e3f4-a5b6-7890-cdef-012345678901',
  })
  @ApiOkResponse({
    description: 'Ordered list of managers and moderators with signed avatar URLs.',
    schema: { example: wrapData(MANAGER_EXAMPLE) },
  })
  @ApiNotFoundResponse({
    description: 'Community not found.',
    schema: {
      example: wrapData({ message: 'Community not found', error: 'Not Found', statusCode: 404 }),
    },
  })
  getManagers(@Param('id', ParseUUIDPipe) id: string) {
    return this.overviewService.getManagers(id);
  }

  // ─── Get single ────────────────────────────────────────────────────────────

  @Get(':id')
  @ApiOperation({
    summary: 'Get community detail (admin)',
    description:
      'Returns the full community record including settings, interests, cities, and linked events. ' +
      'Use this to populate the community edit form. ' +
      'For the dashboard overview (stats, sparklines, managers, activity), use `GET :id/overview` instead.',
  })
  @ApiParam({
    name: 'id',
    description: 'UUID of the community.',
    example: 'c1d2e3f4-a5b6-7890-cdef-012345678901',
  })
  @ApiOkResponse({
    description: 'Full community detail with settings and relations.',
    schema: {
      example: wrapData({
        ...COMMUNITY_EXAMPLE,
        primaryCity: 'Kolkata',
        communityCities: ['Kolkata', 'Mumbai'],
        interests: [{ id: 'i1', name: 'Electronic Music' }, { id: 'i2', name: 'Nightlife' }],
        settings: {
          announcementsEnabled: true,
          chatEnabled: true,
          feedEnabled: true,
          memberPostingAllowed: true,
        },
      }),
    },
  })
  @ApiNotFoundResponse({
    description: 'Community not found.',
    schema: {
      example: wrapData({ message: 'Community not found', error: 'Not Found', statusCode: 404 }),
    },
  })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.communitiesService.findOneForAdmin(id);
  }

  // ─── Create ────────────────────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create community (Step 1 of 5)',
    description:
      'Creates a community in `DRAFT` status. The calling admin becomes the `OWNER`. ' +
      'Follow the 5-step setup flow to complete the community before publishing:\n\n' +
      '1. **Create** (`POST /`) — name, description, type, category\n' +
      '2. **Settings** (`PUT :id/settings`) — posting rules, moderation, features\n' +
      '3. **Interests + Cities** (`PUT :id/interests`, `PUT :id/cities`) — drives auto-matching\n' +
      '4. **Assign managers** (`POST :id/members`) — owner can add managers, moderators\n' +
      '5. **Publish** (`POST :id/publish`) — transitions to `PUBLISHED` and triggers the first event resync',
  })
  @ApiCreatedResponse({
    description: 'Community created in DRAFT status. Use the returned `id` for subsequent steps.',
    schema: {
      example: wrapData({
        ...COMMUNITY_EXAMPLE,
        status: 'DRAFT',
        memberCount: 1,
        createdAt: '2026-06-26T10:00:00.000Z',
      }),
    },
  })
  @ApiBadRequestResponse({
    description: 'Validation failed — e.g. name too short, invalid category UUID, unknown type.',
    schema: {
      example: wrapData({ message: ['name should not be empty'], error: 'Bad Request', statusCode: 400 }),
    },
  })
  create(@GetUser('id') adminId: string, @Body() dto: CreateCommunityDto) {
    return this.communitiesService.create(adminId, dto);
  }

  // ─── Update ────────────────────────────────────────────────────────────────

  @Patch(':id')
  @ApiOperation({
    summary: 'Update community top-level fields',
    description:
      'Partial update for core community fields: `name`, `description`, `type`, `access`, ' +
      '`memberVisibility`, `coverImageKey`, `iconKey`, `autoAddMatchingEvents`. ' +
      'Does not affect interests, cities, members, settings, or status — use the dedicated endpoints for those.',
  })
  @ApiParam({
    name: 'id',
    description: 'UUID of the community to update.',
    example: 'c1d2e3f4-a5b6-7890-cdef-012345678901',
  })
  @ApiOkResponse({
    description: 'Updated community record.',
    schema: {
      example: wrapData({ ...COMMUNITY_EXAMPLE, name: 'Meetday Music Nights – Kolkata' }),
    },
  })
  @ApiNotFoundResponse({
    description: 'Community not found.',
    schema: {
      example: wrapData({ message: 'Community not found', error: 'Not Found', statusCode: 404 }),
    },
  })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCommunityDto) {
    return this.communitiesService.update(id, dto);
  }

  // ─── Settings ──────────────────────────────────────────────────────────────

  @Put(':id/settings')
  @ApiOperation({
    summary: 'Update community settings (Step 2)',
    description:
      'Replaces the community settings record. Controls which features are enabled and ' +
      'what members are allowed to do:\n\n' +
      '- **Feature flags**: `announcementsEnabled`, `chatEnabled`, `feedEnabled`\n' +
      '- **Permissions**: `memberPostingAllowed`, `memberEventsAllowed`\n' +
      '- **Moderation**: approval requirements, content policies, photo sharing policy\n\n' +
      'All fields are optional — omitted fields keep their current values.',
  })
  @ApiParam({
    name: 'id',
    description: 'UUID of the community.',
    example: 'c1d2e3f4-a5b6-7890-cdef-012345678901',
  })
  @ApiOkResponse({
    description: 'Updated settings object.',
    schema: {
      example: wrapData({
        communityId: 'c1d2e3f4-a5b6-7890-cdef-012345678901',
        announcementsEnabled: true,
        chatEnabled: true,
        feedEnabled: true,
        memberPostingAllowed: true,
        memberEventsAllowed: false,
      }),
    },
  })
  @ApiNotFoundResponse({
    description: 'Community not found.',
    schema: {
      example: wrapData({ message: 'Community not found', error: 'Not Found', statusCode: 404 }),
    },
  })
  updateSettings(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCommunitySettingsDto) {
    return this.communitiesService.updateSettings(id, dto);
  }

  // ─── Interests ─────────────────────────────────────────────────────────────

  @Put(':id/interests')
  @ApiOperation({
    summary: 'Set community interests (Step 3.1)',
    description:
      'Replaces the community\'s interest list entirely (not additive). ' +
      'Interests drive the auto-match engine: when `POST :id/events/resync` runs, ' +
      'it finds events whose category maps to any of these interests via the `InterestCategory` table. ' +
      'To clear all interests, send an empty `interestIds` array.',
  })
  @ApiParam({
    name: 'id',
    description: 'UUID of the community.',
    example: 'c1d2e3f4-a5b6-7890-cdef-012345678901',
  })
  @ApiOkResponse({
    description: 'Interests updated.',
    schema: {
      example: wrapData({ success: true }),
    },
  })
  @ApiNotFoundResponse({
    description: 'Community not found.',
    schema: {
      example: wrapData({ message: 'Community not found', error: 'Not Found', statusCode: 404 }),
    },
  })
  setInterests(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetCommunityInterestsDto) {
    return this.communitiesService.setInterests(id, dto);
  }

  // ─── Cities ────────────────────────────────────────────────────────────────

  @Put(':id/cities')
  @ApiOperation({
    summary: 'Set community cities (Step 3.2)',
    description:
      'Sets the community\'s geographic scope. Two fields:\n\n' +
      '- `primaryCity`: the main display city shown on the community card.\n' +
      '- `communityCities`: full list of cities used by the auto-match engine to filter events by location. ' +
      'Must include `primaryCity`. Replacing this list clears the old set entirely.',
  })
  @ApiParam({
    name: 'id',
    description: 'UUID of the community.',
    example: 'c1d2e3f4-a5b6-7890-cdef-012345678901',
  })
  @ApiOkResponse({
    description: 'Cities updated.',
    schema: { example: wrapData({ success: true }) },
  })
  @ApiNotFoundResponse({
    description: 'Community not found.',
    schema: {
      example: wrapData({ message: 'Community not found', error: 'Not Found', statusCode: 404 }),
    },
  })
  setCities(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetCommunityCitiesDto) {
    return this.communitiesService.setCities(id, dto);
  }

  // ─── Assign member ─────────────────────────────────────────────────────────

  @Post(':id/members')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Assign a manager / moderator role (Step 4)',
    description:
      'Grants a privileged role to a platform user, adding them to the community as an active member ' +
      'if they are not already one. Assignable roles: `MANAGER`, `MODERATOR`, `HOST`. ' +
      'The `OWNER` role is set automatically on the creating admin and cannot be assigned here. ' +
      'The `MEMBER` role is also not assignable here — members join via the public join flow.',
  })
  @ApiParam({
    name: 'id',
    description: 'UUID of the community.',
    example: 'c1d2e3f4-a5b6-7890-cdef-012345678901',
  })
  @ApiCreatedResponse({
    description: 'Role assigned. Returns the new community member record.',
    schema: {
      example: wrapData({
        id: 'm1n2o3p4-q5r6-7890-st12-uvwx01234567',
        communityId: 'c1d2e3f4-a5b6-7890-cdef-012345678901',
        userId: 'u2b3c4d5-e6f7-8901-bc23-def012345678',
        role: 'MANAGER',
        status: 'ACTIVE',
        joinedAt: '2026-06-26T10:00:00.000Z',
      }),
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid role supplied (e.g. `OWNER` or `MEMBER`).',
    schema: {
      example: wrapData({ message: ['role must be a valid enum value'], error: 'Bad Request', statusCode: 400 }),
    },
  })
  @ApiNotFoundResponse({
    description: 'Community or user not found.',
    schema: {
      example: wrapData({ message: 'Community not found', error: 'Not Found', statusCode: 404 }),
    },
  })
  assignMember(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') adminId: string,
    @Body() dto: AssignMemberDto,
  ) {
    return this.communitiesService.assignMember(id, adminId, dto);
  }

  // ─── Remove member ─────────────────────────────────────────────────────────

  @Delete(':id/members/:memberId')
  @ApiOperation({
    summary: 'Remove a role assignment',
    description:
      'Removes the privileged role of a manager, moderator, or host. ' +
      'Note: `:memberId` is the **community member row UUID** (from `GET :id/managers`), ' +
      'not the platform user\'s UUID. ' +
      'The user remains a standard `MEMBER` of the community — they are not kicked out.',
  })
  @ApiParam({
    name: 'id',
    description: 'UUID of the community.',
    example: 'c1d2e3f4-a5b6-7890-cdef-012345678901',
  })
  @ApiParam({
    name: 'memberId',
    description: 'UUID of the community member row (NOT the user UUID). Obtain from `GET :id/managers`.',
    example: 'm1n2o3p4-q5r6-7890-st12-uvwx01234567',
  })
  @ApiOkResponse({
    schema: { example: wrapData({ success: true }) },
  })
  @ApiNotFoundResponse({
    description: 'Community or member record not found.',
    schema: {
      example: wrapData({ message: 'Member not found', error: 'Not Found', statusCode: 404 }),
    },
  })
  removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @GetUser('id') adminId: string,
  ) {
    return this.communitiesService.removeMember(id, adminId, memberId);
  }

  // ─── Add event ─────────────────────────────────────────────────────────────

  @Post(':id/events')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Manually attach an event (Step 3.4)',
    description:
      'Links an existing published event to the community with `source = MANUAL`. ' +
      'Manual links persist across re-syncs — they are never removed by `POST :id/events/resync`. ' +
      'The event must be in `PUBLISHED` status.',
  })
  @ApiParam({
    name: 'id',
    description: 'UUID of the community.',
    example: 'c1d2e3f4-a5b6-7890-cdef-012345678901',
  })
  @ApiCreatedResponse({
    description: 'Event linked.',
    schema: {
      example: wrapData({
        communityId: 'c1d2e3f4-a5b6-7890-cdef-012345678901',
        eventId: 'e1f2a3b4-c5d6-7890-ef12-345678901234',
        source: 'MANUAL',
        addedAt: '2026-06-26T10:00:00.000Z',
      }),
    },
  })
  @ApiNotFoundResponse({
    description: 'Community or event not found.',
    schema: {
      example: wrapData({ message: 'Event not found', error: 'Not Found', statusCode: 404 }),
    },
  })
  addEvent(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') adminId: string,
    @Body() dto: AddCommunityEventDto,
  ) {
    return this.communitiesService.addEvent(id, adminId, dto);
  }

  // ─── Remove event ──────────────────────────────────────────────────────────

  @Delete(':id/events/:eventId')
  @ApiOperation({
    summary: 'Detach an event from the community',
    description:
      'Removes a community–event link regardless of `source` (MANUAL or AUTO). ' +
      'If you remove an AUTO link without also removing the relevant interests/cities, ' +
      'the event will be re-attached on the next `POST :id/events/resync`.',
  })
  @ApiParam({
    name: 'id',
    description: 'UUID of the community.',
    example: 'c1d2e3f4-a5b6-7890-cdef-012345678901',
  })
  @ApiParam({
    name: 'eventId',
    description: 'UUID of the event to detach.',
    example: 'e1f2a3b4-c5d6-7890-ef12-345678901234',
  })
  @ApiOkResponse({
    schema: { example: wrapData({ success: true }) },
  })
  @ApiNotFoundResponse({
    description: 'Community–event link not found.',
    schema: {
      example: wrapData({ message: 'Event link not found', error: 'Not Found', statusCode: 404 }),
    },
  })
  removeEvent(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.communitiesService.removeEvent(id, eventId);
  }

  // ─── Resync events ─────────────────────────────────────────────────────────

  @Post(':id/events/resync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Recompute auto-matched events',
    description:
      'Runs the auto-match algorithm for this community:\n\n' +
      '1. Loads the community\'s interests and maps them to event categories via `InterestCategory`.\n' +
      '2. Finds all `PUBLISHED` events in the community\'s cities whose `categoryId` is in that mapped set.\n' +
      '3. Replaces all existing `AUTO` links with the new results. `MANUAL` links are never touched.\n\n' +
      'This runs automatically on `POST :id/publish` (Step 5). ' +
      'Call it manually after updating interests or cities to refresh the matched event set immediately.',
  })
  @ApiParam({
    name: 'id',
    description: 'UUID of the community.',
    example: 'c1d2e3f4-a5b6-7890-cdef-012345678901',
  })
  @ApiOkResponse({
    description: '`matched` = total eligible events found; `attached` = new AUTO links created (excludes events already linked as MANUAL).',
    schema: {
      example: wrapData({ matched: 18, attached: 12 }),
    },
  })
  @ApiNotFoundResponse({
    description: 'Community not found.',
    schema: {
      example: wrapData({ message: 'Community not found', error: 'Not Found', statusCode: 404 }),
    },
  })
  resyncEvents(@Param('id', ParseUUIDPipe) id: string) {
    return this.communitiesService.resyncEvents(id);
  }

  // ─── Publish ───────────────────────────────────────────────────────────────

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Publish the community (Step 5)',
    description:
      'Transitions the community from `DRAFT` to `PUBLISHED`. Once published:\n\n' +
      '- The community becomes visible to all members in their city.\n' +
      '- `POST :id/events/resync` is triggered automatically to populate the event list.\n' +
      '- `publishedAt` is set on the community record.\n\n' +
      'This action is not reversible via the API — use `PATCH :id` to set `status: ARCHIVED` to deactivate.',
  })
  @ApiParam({
    name: 'id',
    description: 'UUID of the community to publish.',
    example: 'c1d2e3f4-a5b6-7890-cdef-012345678901',
  })
  @ApiOkResponse({
    description: 'Community published.',
    schema: {
      example: wrapData({
        ...COMMUNITY_EXAMPLE,
        status: 'PUBLISHED',
        publishedAt: '2026-06-26T10:00:00.000Z',
      }),
    },
  })
  @ApiBadRequestResponse({
    description: 'Community is not in DRAFT status.',
    schema: {
      example: wrapData({ message: 'Community is already published', error: 'Bad Request', statusCode: 400 }),
    },
  })
  @ApiNotFoundResponse({
    description: 'Community not found.',
    schema: {
      example: wrapData({ message: 'Community not found', error: 'Not Found', statusCode: 404 }),
    },
  })
  publish(@Param('id', ParseUUIDPipe) id: string, @GetUser('id') adminId: string) {
    return this.communitiesService.publish(id, adminId);
  }
}
