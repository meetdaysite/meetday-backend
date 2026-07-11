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
import { CommunityAnalyticsService } from './community-analytics.service';
import { CommunityExperiencesAdminService } from './community-experiences-admin.service';
import { CreateCommunityDto } from './dto/create-community.dto';
import { UpdateCommunityDto } from './dto/update-community.dto';
import { UpdateCommunitySettingsDto } from './dto/update-community-settings.dto';
import { SetCommunityInterestsDto } from './dto/set-community-interests.dto';
import { SetCommunityCitiesDto } from './dto/set-community-cities.dto';
import { AssignMemberDto } from './dto/assign-member.dto';
import { AddCommunityEventDto } from './dto/add-community-event.dto';
import { ListCommunitiesQueryDto } from './dto/list-communities-query.dto';
import { ListCommunityExperiencesQueryDto } from './dto/list-community-experiences-query.dto';

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

const GROWTH_SERIES_SAMPLE = [
  { date: '2026-05-27', joined: 28, left: 3, netGrowth: 25 },
  { date: '2026-05-28', joined: 14, left: 1, netGrowth: 13 },
  { date: '2026-05-29', joined: 9,  left: 0, netGrowth: 9  },
  { date: '2026-05-30', joined: 21, left: 2, netGrowth: 19 },
  { date: '2026-05-31', joined: 32, left: 4, netGrowth: 28 },
  { date: '2026-06-01', joined: 18, left: 1, netGrowth: 17 },
  { date: '2026-06-02', joined: 11, left: 0, netGrowth: 11 },
  { date: '2026-06-03', joined: 7,  left: 1, netGrowth: 6  },
  { date: '2026-06-04', joined: 24, left: 2, netGrowth: 22 },
  { date: '2026-06-05', joined: 38, left: 5, netGrowth: 33 },
  { date: '2026-06-06', joined: 16, left: 0, netGrowth: 16 },
  { date: '2026-06-07', joined: 12, left: 1, netGrowth: 11 },
  { date: '2026-06-08', joined: 29, left: 3, netGrowth: 26 },
  { date: '2026-06-09', joined: 19, left: 0, netGrowth: 19 },
  { date: '2026-06-10', joined: 8,  left: 1, netGrowth: 7  },
  { date: '2026-06-11', joined: 22, left: 2, netGrowth: 20 },
  { date: '2026-06-12', joined: 31, left: 4, netGrowth: 27 },
  { date: '2026-06-13', joined: 17, left: 0, netGrowth: 17 },
  { date: '2026-06-14', joined: 14, left: 1, netGrowth: 13 },
  { date: '2026-06-15', joined: 9,  left: 0, netGrowth: 9  },
  { date: '2026-06-16', joined: 26, left: 3, netGrowth: 23 },
  { date: '2026-06-17', joined: 41, left: 6, netGrowth: 35 },
  { date: '2026-06-18', joined: 20, left: 1, netGrowth: 19 },
  { date: '2026-06-19', joined: 13, left: 0, netGrowth: 13 },
  { date: '2026-06-20', joined: 8,  left: 1, netGrowth: 7  },
  { date: '2026-06-21', joined: 35, left: 4, netGrowth: 31 },
  { date: '2026-06-22', joined: 28, left: 2, netGrowth: 26 },
  { date: '2026-06-23', joined: 16, left: 1, netGrowth: 15 },
  { date: '2026-06-24', joined: 22, left: 3, netGrowth: 19 },
  { date: '2026-06-25', joined: 47, left: 5, netGrowth: 42 },
];

const ANALYTICS_EXAMPLE = {
  summary: {
    members:           { value: 1248, deltaPct: 12 },
    activeMembers:     { value: 843,  deltaPct: 8  },
    experiencesBooked: { value: 312,  deltaPct: 23 },
    communityRevenue:  { value: 4680000, deltaPct: 18 },
    retention:         { value: 91,   deltaPct: 0  },
  },
  growth: {
    series: GROWTH_SERIES_SAMPLE,
    totalJoined: 156,
    totalLeft: 22,
    netGrowth: 134,
    growthRatePct: 12,
  },
  engagement: {
    posts:             { value: 128,  changePct: 14  },
    comments:          { value: 492,  changePct: 22  },
    reactions:         { value: 1840, changePct: 31  },
    shares:            { value: 96,   changePct: -4  },
    chatMessages:      { value: 3200, changePct: 19  },
    announcementReach: { value: 4100, changePct: 8   },
  },
  experiencesImpact: {
    totalBookings: { value: 312, changePct: 23 },
    topExperiences: [
      { id: 'e1f2a3b4-c5d6-7890-ef12-345678901234', title: 'Night Rituals',       bookings: 94, revenue: 1410000, attendancePct: 87.5 },
      { id: 'f2a3b4c5-d6e7-8901-f234-567890123456', title: 'After Hours',         bookings: 78, revenue: 1170000, attendancePct: 91.2 },
      { id: 'a3b4c5d6-e7f8-9012-a345-678901234567', title: 'Sunset Sessions',     bookings: 64, revenue: 960000,  attendancePct: 76.4 },
      { id: 'b4c5d6e7-f8a9-0123-b456-789012345678', title: 'Tech House Night',    bookings: 48, revenue: 720000,  attendancePct: 83.3 },
      { id: 'c5d6e7f8-a9b0-1234-c567-890123456789', title: 'Underground Fridays', bookings: 28, revenue: 420000,  attendancePct: 67.9 },
    ],
  },
  healthScore: {
    total: 82,
    rating: 'GOOD',
    factors: {
      memberGrowth:    8,
      engagement:      20,
      eventAttendance: 18,
      reportRate:      20,
      retention:       16,
    },
  },
  memberInsights: {
    interests: [
      { name: 'Electronic Music', pct: 68 },
      { name: 'Nightlife',        pct: 54 },
      { name: 'Live Music',       pct: 41 },
      { name: 'DJ Culture',       pct: 29 },
    ],
    topCities: [
      { city: 'Kolkata',   pct: 72 },
      { city: 'Mumbai',    pct: 15 },
      { city: 'Delhi',     pct: 8  },
      { city: 'Bangalore', pct: 3  },
      { city: 'Hyderabad', pct: 2  },
    ],
    ageDistribution: [
      { range: 'UNDER_18',   label: 'Under 18', pct: 4  },
      { range: 'AGE_18_24',  label: '18–24',    pct: 31 },
      { range: 'AGE_25_34',  label: '25–34',    pct: 44 },
      { range: 'AGE_35_44',  label: '35–44',    pct: 15 },
      { range: 'AGE_45_54',  label: '45–54',    pct: 5  },
      { range: 'AGE_55_PLUS',label: '55+',      pct: 1  },
    ],
  },
  topContributors: [
    { userId: 'u1a2b3c4-d5e6-7890-ab12-cdef01234567', name: 'Rohan Verma',   handle: 'rohan_v',  avatarUrl: 'https://storage.googleapis.com/...', activityScore: 148 },
    { userId: 'u6f7a8b9-c0d1-2345-ef67-123456789012', name: 'Priya Kapoor',  handle: 'priya_k',  avatarUrl: 'https://storage.googleapis.com/...', activityScore: 134 },
    { userId: 'u7a8b9c0-d1e2-3456-f789-234567890123', name: 'Amit Sharma',   handle: 'amit_s',   avatarUrl: null,                                 activityScore: 117 },
    { userId: 'u8b9c0d1-e2f3-4567-a890-345678901234', name: 'Nisha Gupta',   handle: 'nisha_g',  avatarUrl: 'https://storage.googleapis.com/...', activityScore: 98  },
    { userId: 'u9c0d1e2-f3a4-5678-b901-456789012345', name: 'Karan Malhotra',handle: 'karan_m',  avatarUrl: null,                                 activityScore: 84  },
  ],
  topHosts: [
    { userId: 'u5e6f7a8-b9c0-1234-ef56-012345678901', name: 'Manav Sinha', handle: 'manav_s', avatarUrl: 'https://storage.googleapis.com/...', eventCount: 7 },
    { userId: 'u3c4d5e6-f7a8-9012-cd34-ef0123456789', name: 'Kabir Shah',  handle: 'kabir_s', avatarUrl: 'https://storage.googleapis.com/...', eventCount: 4 },
    { userId: 'u4d5e6f7-a8b9-0123-de45-f01234567890', name: 'Ishita Dey',  handle: 'ishita_d',avatarUrl: null,                                 eventCount: 2 },
  ],
};

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
    private readonly analyticsService: CommunityAnalyticsService,
    private readonly experiencesAdminService: CommunityExperiencesAdminService,
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

  // ─── Analytics ─────────────────────────────────────────────────────────────

  @Get(':id/analytics')
  @ApiOperation({
    summary: 'Community analytics (30-day window)',
    description:
      'Returns the full analytics payload for the admin Analytics tab. All metrics use a fixed ' +
      '**30-day rolling window** (current period = last 30 days; prior period = 30–60 days ago for delta comparisons). ' +
      'Results are cached in Redis for **5 minutes**.\n\n' +
      '**Response sections:**\n\n' +
      '**`summary`** — Five stat cards:\n' +
      '- `members.value` = total member count (denormalized); `deltaPct` = % change in new joins vs prior 30d.\n' +
      '- `activeMembers.value` = members with activity (`lastActivityAt`) in the last 30d.\n' +
      '- `experiencesBooked.value` = confirmed orders on community events in the last 30d.\n' +
      '- `communityRevenue.value` = sum of `totalAmount` on those orders, in **rupees**.\n' +
      '- `retention.value` = `ACTIVE members / all members × 100`; `deltaPct` is always `0` (no historical snapshot).\n\n' +
      '**`growth`** — 30-entry daily series for the member growth chart:\n' +
      '- `joined` / `left` / `netGrowth` per day. Note: `left` uses `updatedAt` as a proxy for `leftAt` ' +
      '(no dedicated timestamp field exists).\n' +
      '- `growthRatePct` = % change in new joins vs the prior 30-day window.\n\n' +
      '**`engagement`** — Six engagement metrics with `changePct` vs the prior 30 days:\n' +
      '`posts`, `comments`, `reactions`, `shares`, `chatMessages`, `announcementReach`.\n' +
      '`announcementReach` is total members notified (fan-out count), **not** literal opens — ' +
      'no open-tracking exists.\n\n' +
      '**`experiencesImpact`** — Booking totals and a top-5 experience table:\n' +
      '- `revenue` is in **rupees**.\n' +
      '- `attendancePct` = checked-in attendees ÷ total booked attendees × 100. ' +
      '`null` when no booking attendee records exist yet.\n\n' +
      '**`healthScore`** — A composite 0–100 score with five factors scored 0–20 each:\n' +
      '`memberGrowth` (net join rate), `engagement` (actions per active member), ' +
      '`eventAttendance` (avg check-in %), `reportRate` (inverse of soft-deleted content ratio), ' +
      '`retention`. Rating bands: `EXCELLENT` ≥ 90, `GOOD` ≥ 75, `FAIR` ≥ 60, `NEEDS_ATTENTION` < 60.\n\n' +
      '**`memberInsights`** — Three demographic breakdowns (percentages):\n' +
      '- `interests`: active members who attended community events in each interest\'s category. ' +
      'Members with no event history will not appear in any bucket.\n' +
      '- `topCities` (top 5): % of members with a known city in their attendee profile.\n' +
      '- `ageDistribution`: % across `AgeRange` enum values. Only members who filled in their age range.\n\n' +
      '**`topContributors`** — Top 5 active members by `activityScore` DESC ' +
      '(formula: `messageCount × 1 + eventsAttendedCount × 5`).\n\n' +
      '**`topHosts`** — Top 3 HOST-role members by event count in this community.',
  })
  @ApiParam({
    name: 'id',
    description: 'UUID of the community.',
    example: 'c1d2e3f4-a5b6-7890-cdef-012345678901',
  })
  @ApiOkResponse({
    description: 'Full analytics payload covering all 8 sections. Cached for 5 minutes.',
    schema: { example: wrapData(ANALYTICS_EXAMPLE) },
  })
  @ApiNotFoundResponse({
    description: 'Community not found or has been deleted.',
    schema: {
      example: wrapData({ message: 'Community not found', error: 'Not Found', statusCode: 404 }),
    },
  })
  getAnalytics(@Param('id', ParseUUIDPipe) id: string) {
    return this.analyticsService.getAnalytics(id);
  }

  // ─── Experiences tab ───────────────────────────────────────────────────────

  @Get(':id/experiences')
  @ApiOperation({
    summary: 'List community experiences (admin)',
    description:
      'Returns paginated experiences (events) linked to the community with stats, tab counts, ' +
      'and a 30-day performance sidebar. Supports filtering by status, search by title, and sorting.',
  })
  @ApiParam({ name: 'id', description: 'Community UUID', example: 'c1d2e3f4-a5b6-7890-cdef-012345678901' })
  @ApiOkResponse({ description: 'Community experiences page data.' })
  getExperiences(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListCommunityExperiencesQueryDto,
  ) {
    return this.experiencesAdminService.listExperiences(id, query);
  }

  // ─── Dashboard stats ───────────────────────────────────────────────────────

  @Get('stats')
  @ApiOperation({
    summary: 'All-communities dashboard stats',
    description:
      'Returns the five aggregate stat cards shown at the top of the All Communities admin page.\n\n' +
      '**Fields per card:**\n' +
      '- `value` — current aggregate value.\n' +
      '- `deltaPct` — percentage change vs the prior 30-day window (positive = growth). ' +
      '`null` for `avgEngagementPct` (no historical snapshot available).\n\n' +
      '**Card definitions:**\n' +
      '- `totalCommunities` — all non-deleted communities.\n' +
      '- `activeCommunities` — communities in `PUBLISHED` status.\n' +
      '- `totalMembers` — sum of denormalized `memberCount` across all communities.\n' +
      '- `upcomingEvents` — distinct `PUBLISHED` events with a future `eventDate` linked to at least one community.\n' +
      '- `avgEngagementPct` — average of `(activeMembers / memberCount × 100)` per `PUBLISHED` community, ' +
      'where active = members with `lastActivityAt` in the last 30 days.',
  })
  @ApiOkResponse({
    description: 'Five dashboard stat cards.',
    schema: {
      example: wrapData({
        totalCommunities:  { value: 24,   deltaPct: 12 },
        activeCommunities: { value: 18,   deltaPct: 8  },
        totalMembers:      { value: 18600, deltaPct: 15 },
        upcomingEvents:    { value: 96,   deltaPct: 10 },
        avgEngagementPct:  { value: 72.0, deltaPct: null },
      }),
    },
  })
  getDashboardStats() {
    return this.communitiesService.getAdminDashboardStats();
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

  // ─── Archive ───────────────────────────────────────────────────────────────

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Archive the community',
    description:
      'Transitions the community from `PUBLISHED` to `ARCHIVED`.\n\n' +
      '- The community disappears from public discovery, browse, and `GET /communities/:slug` (returns 404 for members).\n' +
      '- New members cannot join — `POST /communities/:id/join` returns 404.\n' +
      '- Existing members retain access to historical content (chat, feed, announcements).\n' +
      '- All community data is preserved. Use `POST :id/restore` to bring it back to PUBLISHED.\n\n' +
      'Throws `400` if the community is not currently `PUBLISHED`.',
  })
  @ApiParam({ name: 'id', description: 'UUID of the community to archive.', example: 'c1d2e3f4-a5b6-7890-cdef-012345678901' })
  @ApiOkResponse({ schema: { example: wrapData({ success: true }) } })
  @ApiBadRequestResponse({
    description: 'Community is not in PUBLISHED status.',
    schema: { example: wrapData({ message: 'Only PUBLISHED communities can be archived', error: 'Bad Request', statusCode: 400 }) },
  })
  @ApiNotFoundResponse({
    description: 'Community not found.',
    schema: { example: wrapData({ message: 'Community not found', error: 'Not Found', statusCode: 404 }) },
  })
  archive(@Param('id', ParseUUIDPipe) id: string, @GetUser('id') adminId: string) {
    return this.communitiesService.archive(id, adminId);
  }

  // ─── Restore ───────────────────────────────────────────────────────────────

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Restore an archived community',
    description:
      'Transitions the community from `ARCHIVED` back to `PUBLISHED`.\n\n' +
      '- The community reappears on public discovery and browse.\n' +
      '- Members can join again.\n\n' +
      'Throws `400` if the community is not currently `ARCHIVED`.',
  })
  @ApiParam({ name: 'id', description: 'UUID of the community to restore.', example: 'c1d2e3f4-a5b6-7890-cdef-012345678901' })
  @ApiOkResponse({ schema: { example: wrapData({ success: true }) } })
  @ApiBadRequestResponse({
    description: 'Community is not in ARCHIVED status.',
    schema: { example: wrapData({ message: 'Only ARCHIVED communities can be restored', error: 'Bad Request', statusCode: 400 }) },
  })
  @ApiNotFoundResponse({
    description: 'Community not found.',
    schema: { example: wrapData({ message: 'Community not found', error: 'Not Found', statusCode: 404 }) },
  })
  restore(@Param('id', ParseUUIDPipe) id: string, @GetUser('id') adminId: string) {
    return this.communitiesService.restore(id, adminId);
  }

  // ─── Delete ────────────────────────────────────────────────────────────────

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Soft-delete the community',
    description:
      'Soft-deletes the community by setting `deletedAt = now()`. The community is hidden from all admin and member lists immediately.\n\n' +
      '**Allowed for:** `DRAFT` and `ARCHIVED` communities only.\n\n' +
      '**Blocked for:** `PUBLISHED` communities — archive the community first (`POST :id/archive`) before deleting.\n\n' +
      'All underlying data (members, posts, chat, events) is retained in the database and not hard-deleted. ' +
      'This action is logged as `COMMUNITY_DELETED` in the audit log.',
  })
  @ApiParam({ name: 'id', description: 'UUID of the community to delete.', example: 'c1d2e3f4-a5b6-7890-cdef-012345678901' })
  @ApiOkResponse({ schema: { example: wrapData({ success: true }) } })
  @ApiBadRequestResponse({
    description: 'Community is PUBLISHED — must be archived first.',
    schema: { example: wrapData({ message: 'Archive the community before deleting it', error: 'Bad Request', statusCode: 400 }) },
  })
  @ApiNotFoundResponse({
    description: 'Community not found or already deleted.',
    schema: { example: wrapData({ message: 'Community not found', error: 'Not Found', statusCode: 404 }) },
  })
  softDelete(@Param('id', ParseUUIDPipe) id: string, @GetUser('id') adminId: string) {
    return this.communitiesService.softDelete(id, adminId);
  }
}
