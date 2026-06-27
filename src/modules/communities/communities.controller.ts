import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { OptionalAuthGuard } from '../../common/guards/optional-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { CommunitiesService } from './communities.service';
import { ListCommunitiesQueryDto } from './dto/list-communities-query.dto';
import { RecommendCommunitiesQueryDto } from './dto/recommend-communities-query.dto';
import { JoinCommunityDto } from './dto/join-community.dto';
import { CommunityEventsQueryDto } from './dto/community-events-query.dto';
import { ListSavedCommunitiesQueryDto } from './dto/list-saved-communities-query.dto';
import { ListJoinedCommunitiesQueryDto } from './dto/list-joined-communities-query.dto';
import { ListHostCommunitiesQueryDto } from './dto/list-host-communities-query.dto';
import { HostEligibleEventsQueryDto } from './dto/host-eligible-events-query.dto';
import { AddCommunityEventDto } from './dto/add-community-event.dto';

@ApiTags('Communities')
@ApiBearerAuth('firebase-token')
@Controller('communities')
export class CommunitiesController {
  constructor(private readonly communitiesService: CommunitiesService) {}

  @Get()
  @Public()
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({ summary: 'Browse published communities' })
  @ApiOkResponse({ description: 'Paginated list of discoverable communities. Each item includes `isMember: boolean` (true when the authenticated caller belongs to that community; always false for unauthenticated requests).' })
  browse(@Query() query: ListCommunitiesQueryDto, @GetUser('uid') firebaseUid: string | null) {
    return this.communitiesService.listPublic(query, firebaseUid);
  }

  @Get('recommended')
  @Public()
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({
    summary: 'Communities recommended by interest overlap (public or authenticated)',
    description: [
      '**No token (public):** Optionally pass `interestIds[]` query params to drive ranking. If none are provided, all communities are returned sorted by memberCount. Sorted by overlap count → memberCount when interests are supplied. The `cityMatch` field is not included in the response.',
      '**With Bearer token (authenticated):** `interestIds` is ignored. The caller\'s stored LIKED/OPEN_TO affinities are used instead. Communities the caller already belongs to are excluded. Each result includes `cityMatch: boolean` based on their profile city.',
      'In both modes: only PUBLISHED, non-INVITE_ONLY communities are returned. Supports `city`, `categoryId`, and `search` filters.',
    ].join('\n\n'),
  })
  @ApiOkResponse({
    description:
      'Paginated list. Each item includes `matchScore` (integer). Authenticated callers also receive `cityMatch` (boolean) on each item.',
  })
  recommended(@Query() query: RecommendCommunitiesQueryDto, @GetUser('uid') firebaseUid: string | null) {
    return this.communitiesService.recommendForUser(firebaseUid, query);
  }

  @Get(':slug/events')
  @Public()
  @ApiOperation({
    summary: 'Events linked to a published community',
    description: 'Returns events ordered by eventDate ascending. Pass `upcoming=true` to restrict to PUBLISHED events with eventDate >= now.',
  })
  @ApiOkResponse({ description: 'Paginated event list with cover image, attendee count, min price, and host.' })
  getCommunityEvents(@Param('slug') slug: string, @Query() query: CommunityEventsQueryDto) {
    return this.communitiesService.getEvents(slug, query);
  }

  @Get(':slug/hosts')
  @Public()
  @ApiOperation({ summary: 'HOST-role members of a published community, ordered by event count' })
  @ApiOkResponse({ description: 'Array of hosts with brandName, avatarUrl, and eventCount (events in this community).' })
  getCommunityHosts(@Param('slug') slug: string) {
    return this.communitiesService.getHosts(slug);
  }

  @Get(':slug/stats')
  @Public()
  @ApiOperation({ summary: 'Aggregate stats for a published community' })
  @ApiOkResponse({
    description: 'memberCount, experienceCount, pendingCount, newMembersThisWeek, hostCount.',
    schema: {
      example: { memberCount: 1600, experienceCount: 12, pendingCount: 4, newMembersThisWeek: 23, hostCount: 3 },
    },
  })
  getCommunityStats(@Param('slug') slug: string) {
    return this.communitiesService.getStats(slug);
  }

  @Get('saved')
  @ApiOperation({ summary: 'List communities saved by the authenticated user' })
  @ApiOkResponse({ description: 'Paginated list of saved communities. Each item includes `isSaved: true` and `isMember`.' })
  listSaved(@GetUser('uid') firebaseUid: string, @Query() query: ListSavedCommunitiesQueryDto) {
    return this.communitiesService.listSaved(firebaseUid, query);
  }

  @Get('joined')
  @ApiOperation({
    summary: 'List communities the authenticated user has joined or is pending in',
    description: [
      'Returns all communities where the caller holds an **ACTIVE** or **PENDING** `CommunityMember` record, ordered by `joinedAt` descending (most recently joined first).',
      '**ACTIVE** — full members of a PUBLIC community, or approved members of an APPROVAL_REQUIRED community.',
      '**PENDING** — submitted a join request to an APPROVAL_REQUIRED community; awaiting admin approval.',
      'Only communities with `status = PUBLISHED` are returned. Communities the caller has left or been banned from are excluded.',
    ].join('\n\n'),
  })
  @ApiOkResponse({
    description: 'Paginated list. Each item includes the community fields plus membership metadata.',
    schema: {
      example: {
        data: [
          {
            id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
            name: 'Meetday Music Nights',
            slug: 'meetday-music-nights',
            description: 'A community for live music lovers in Kolkata.',
            type: 'MEETDAY_MANAGED_PUBLIC',
            access: 'PUBLIC',
            primaryCity: 'Kolkata',
            communityCities: ['Kolkata', 'Mumbai'],
            coverImageUrl: 'https://storage.example.com/signed/cover.jpg',
            iconUrl: 'https://storage.example.com/signed/icon.png',
            memberCount: 1600,
            experienceCount: 12,
            category: { id: 'cat-uuid', name: 'Music' },
            role: 'MEMBER',
            memberStatus: 'ACTIVE',
            joinedAt: '2026-05-10T08:00:00.000Z',
            isSaved: true,
          },
          {
            id: 'a1b2c3d4-0000-4562-b3fc-2c963f66afa6',
            name: 'Indie Film Collective',
            slug: 'indie-film-collective',
            description: 'Curated screenings and discussions for independent cinema fans.',
            type: 'HOST_LED',
            access: 'APPROVAL_REQUIRED',
            primaryCity: 'Mumbai',
            communityCities: ['Mumbai'],
            coverImageUrl: 'https://storage.example.com/signed/indie-cover.jpg',
            iconUrl: null,
            memberCount: 340,
            experienceCount: 5,
            category: { id: 'cat-uuid-2', name: 'Film' },
            role: 'MEMBER',
            memberStatus: 'PENDING',
            joinedAt: null,
            isSaved: false,
          },
        ],
        total: 2,
        page: 1,
        limit: 20,
      },
    },
  })
  listJoined(@GetUser('uid') firebaseUid: string, @Query() query: ListJoinedCommunitiesQueryDto) {
    return this.communitiesService.listJoined(firebaseUid, query);
  }

  @Get('host/browse')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @ApiOperation({
    summary: 'Browse communities as a host',
    description: [
      'Returns all PUBLISHED communities — including INVITE_ONLY — enriched with host-specific fields.',
      '',
      '**Host-enriched fields:**',
      '- `isVerified` — true when the community is Meetday-managed (`type = MEETDAY_MANAGED_PUBLIC`). Drives the "VERIFIED" badge in the UI.',
      '- `matchScore` — 0–100 percentage showing how well the host\'s experience categories map to the community\'s interest tags. `null` when the community has no interest tags configured.',
      '- `matchLabel` — human-readable match label: `"Great match!"` (≥90), `"High engagement"` (≥75), or `null` below that threshold.',
      '- `avgHostRating` — average star rating (1–5) that attendees gave to hosts for events published within this community. `null` when no rated events exist. Signals the quality bar of the community\'s audience.',
      '- `experiencesThisMonth` — count of events in this community whose `eventDate` falls within the current calendar month.',
      '- `isMember` — true when the calling host has ACTIVE membership in this community.',
      '- `isPending` — true when the calling host has a pending join request (APPROVAL_REQUIRED communities only).',
      '',
      '**Filtering:**',
      '- Use `tab` to switch between All / Public / Approval Required / Invite Only / My Communities.',
      '- Use `audienceSize` to filter by member count band (independent of tab).',
      '- Use `access` as a standalone Access Type dropdown filter; applies on ALL and MY_COMMUNITIES tabs.',
      '- `city`, `categoryId`, and `search` can be combined freely with any tab.',
    ].join('\n'),
  })
  @ApiOkResponse({
    description: 'Paginated list of communities with host enrichment.',
    schema: {
      example: {
        data: [
          {
            id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
            slug: 'meetday-music-nights',
            name: 'Meetday Music Nights',
            description: 'Electronic, live sets, rooftop parties and underground music experiences.',
            type: 'MEETDAY_MANAGED_PUBLIC',
            access: 'PUBLIC',
            primaryCity: 'All Cities',
            communityCities: ['Bangalore', 'Mumbai', 'Delhi'],
            coverImageUrl: 'https://cdn.example.com/signed/cover.jpg',
            iconUrl: 'https://cdn.example.com/signed/icon.png',
            memberCount: 1200,
            experienceCount: 34,
            category: { id: 'cat-uuid', name: 'Music' },
            isVerified: true,
            experiencesThisMonth: 18,
            avgHostRating: 4.8,
            matchScore: 96,
            matchLabel: 'Great match!',
            isMember: true,
            isPending: false,
          },
          {
            id: 'b2c3d4e5-0000-4562-b3fc-2c963f66afa6',
            slug: 'startup-builders',
            name: 'Startup Builders',
            description: 'Events, workshops and networking for founders and innovators.',
            type: 'MEETDAY_MANAGED_PUBLIC',
            access: 'APPROVAL_REQUIRED',
            primaryCity: 'All Cities',
            communityCities: ['Bangalore', 'Hyderabad'],
            coverImageUrl: 'https://cdn.example.com/signed/cover2.jpg',
            iconUrl: 'https://cdn.example.com/signed/icon2.png',
            memberCount: 650,
            experienceCount: 20,
            category: { id: 'cat-uuid-2', name: 'Business' },
            isVerified: true,
            experiencesThisMonth: 12,
            avgHostRating: 4.6,
            matchScore: null,
            matchLabel: null,
            isMember: false,
            isPending: false,
          },
        ],
        total: 42,
        page: 1,
        limit: 20,
        totalPages: 3,
      },
    },
  })
  browseForHost(@GetUser('id') userId: string, @Query() query: ListHostCommunitiesQueryDto) {
    return this.communitiesService.listForHost(userId, query);
  }

  @Get('host/activity')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @ApiOperation({
    summary: 'Host community activity summary',
    description: [
      'Returns the five counters that populate the "Your Community Activity" sidebar on the Communities page.',
      '',
      '**Fields:**',
      '- `communitiesJoined` — communities where the calling host holds ACTIVE membership.',
      '- `accessRequests` — communities where the host has a PENDING join request awaiting admin approval.',
      '- `pendingReviews` — attendee reviews left on the host\'s events that are linked to communities, received in the last 30 days.',
      '- `experiencesInCommunities` — count of distinct events (across all statuses) published by this host that are linked to at least one community.',
      '- `totalCommunityViews` — total confirmed bookings across the host\'s community-linked events. Used as a reach proxy since event page views are not tracked.',
    ].join('\n'),
  })
  @ApiOkResponse({
    description: 'Host community activity counts.',
    schema: {
      example: {
        communitiesJoined: 2,
        accessRequests: 2,
        pendingReviews: 1,
        experiencesInCommunities: 3,
        totalCommunityViews: 8420,
      },
    },
  })
  getHostActivity(@GetUser('id') userId: string) {
    return this.communitiesService.getHostActivity(userId);
  }

  @Get(':communityId/host/overview')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @ApiOperation({
    summary: 'Community overview page (host perspective)',
    description: [
      'Returns the full detail page data a host sees when clicking into a community from their dashboard.',
      '',
      '**Sections returned:**',
      '- `community` — name, slug, type, access, verified badge, cover/icon URLs, interest tags, category.',
      '- `audience` — `matchScore` (0–100 | null), `matchLabel`, `matchDescription`, member count + growth %, top age group, gender split (null until members set gender), top cities.',
      '- `hostContext` — membership status (`isMember`, `isPending`, `role`), derived permissions.',
      '- `stats` — totalViews (confirmed bookings proxy), experiencesPublished, monthlyActiveMembers, avgEngagementRate.',
      '- `upcomingExperiences` — next 4 PUBLISHED events in this community ordered by date.',
      '',
      '`genderSplit` is null until community members self-identify gender via `PATCH /attendee/profile`.',
    ].join('\n'),
  })
  @ApiOkResponse({
    description: 'Community overview for the host dashboard detail page.',
    schema: {
      example: {
        community: {
          id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          slug: 'meetday-music-nights',
          name: 'Meetday Music Nights',
          description: 'Electronic, live sets, rooftop parties.',
          type: 'MEETDAY_MANAGED_PUBLIC',
          access: 'PUBLIC',
          isVerified: true,
          primaryCity: 'All Cities',
          communityCities: ['Bangalore', 'Mumbai'],
          coverImageUrl: 'https://cdn.example.com/signed/cover.jpg',
          iconUrl: 'https://cdn.example.com/signed/icon.png',
          interestTags: [{ id: 'int-uuid', name: 'Electronic Music', slug: 'electronic-music' }],
          category: { id: 'cat-uuid', name: 'Music' },
        },
        audience: {
          matchScore: 96,
          matchLabel: 'Great match!',
          matchDescription: 'Your audience aligns well with this community.',
          memberCount: 1200,
          memberGrowthPct: 18.0,
          topAgeGroup: { label: '25-34', pct: 68 },
          genderSplit: { male: 40, female: 22, nonBinary: 2, malePct: 63, femalePct: 34, nonBinaryPct: 3 },
          topCities: ['Bangalore', 'Mumbai', 'Delhi'],
          cityCount: 12,
        },
        hostContext: {
          isMember: true,
          isPending: false,
          role: 'HOST',
          permissions: {
            canSubmitExperiences: true,
            canReplyToComments: true,
            canViewAnalytics: true,
            canReceiveUpdates: true,
          },
        },
        stats: {
          totalViews: 24560,
          experiencesPublished: 412,
          monthlyActiveMembers: 1024,
          avgEngagementRate: 85.3,
        },
        upcomingExperiences: [
          {
            id: 'evt-uuid',
            title: 'Rooftop Sunset Sessions',
            eventDate: '2026-07-15T00:00:00.000Z',
            startTime: '18:00',
            city: 'Bangalore',
            coverImageUrl: 'https://cdn.example.com/signed/event.jpg',
            interestedCount: 120,
          },
        ],
      },
    },
  })
  getHostCommunityOverview(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser('id') userId: string,
  ) {
    return this.communitiesService.getHostCommunityOverview(communityId, userId);
  }

  @Get(':communityId/host/audience')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @ApiOperation({
    summary: 'Community audience analytics (host)',
    description: [
      'Returns the full Audience tab payload for a community — member stats with month-over-month deltas,',
      'age distribution (all 6 buckets), gender split, top cities, audience interests with member percentages,',
      'activity metrics (views/comments/shares), and computed highlights.',
      '',
      'No membership required — any HOST can view audience analytics for any PUBLISHED community.',
    ].join('\n'),
  })
  @ApiOkResponse({
    description: 'Full audience analytics for the host dashboard Audience tab.',
    schema: {
      example: {
        stats: {
          totalMembers: 1200,
          totalMemberGrowthPct: 18.0,
          newMembersThisMonth: 320,
          newMemberGrowthPct: 15.0,
          engagementRate: 78.5,
          engagementRateDelta: 8.2,
          avgExperienceRating: 4.6,
          avgExperienceRatingDelta: 0.4,
        },
        demographics: {
          ageDistribution: [
            { range: 'UNDER_18', label: 'Under 18', count: 0, pct: 0 },
            { range: 'AGE_18_24', label: '18-24', count: 180, pct: 35.3 },
            { range: 'AGE_25_34', label: '25-34', count: 220, pct: 43.1 },
            { range: 'AGE_35_44', label: '35-44', count: 80, pct: 15.7 },
            { range: 'AGE_45_54', label: '45-54', count: 22, pct: 4.3 },
            { range: 'AGE_55_PLUS', label: '55+', count: 8, pct: 1.6 },
          ],
          genderSplit: { male: 40, female: 22, nonBinary: 2, malePct: 63, femalePct: 34, nonBinaryPct: 3 },
        },
        topCities: [
          { city: 'Bangalore', count: 520, pct: 43.3 },
          { city: 'Mumbai', count: 280, pct: 23.3 },
        ],
        interests: [
          { id: 'int-uuid', name: 'Electronic Music', slug: 'electronic-music', memberPct: 72.0 },
        ],
        activity: {
          eventViews: { total: 24560, growthPct: 12.5 },
          comments: { total: 3402, growthPct: -4.2 },
          shares: { total: 890, growthPct: 8.0 },
        },
        highlights: ['Highly active audience', 'Strong interest in Electronic Music'],
      },
    },
  })
  getHostCommunityAudience(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser('id') userId: string,
  ) {
    return this.communitiesService.getHostCommunityAudience(communityId, userId);
  }

  @Get(':communityId/host/eligible-events')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @ApiOperation({
    summary: 'Host\'s published events eligible to add to a community',
    description: [
      'Returns the calling host\'s PUBLISHED events that are **not already linked** to this community.',
      'Caller must be an ACTIVE member of the community (403 otherwise).',
      'Use this to populate the "Add event" picker modal on the community overview page.',
    ].join('\n'),
  })
  @ApiOkResponse({
    description: 'Paginated list of events eligible for addition to this community.',
    schema: {
      example: {
        data: [
          {
            id: 'evt-uuid',
            title: 'Saturday Night Jazz',
            eventDate: '2026-08-10T00:00:00.000Z',
            city: 'Mumbai',
            coverImageUrl: 'https://cdn.example.com/signed/jazz.jpg',
            category: { id: 'cat-uuid', name: 'Music' },
          },
        ],
        total: 5,
        page: 1,
        limit: 20,
      },
    },
  })
  getHostEligibleEvents(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser('id') userId: string,
    @Query() query: HostEligibleEventsQueryDto,
  ) {
    return this.communitiesService.getHostEligibleEvents(communityId, userId, query);
  }

  @Post(':communityId/host/events')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @ApiOperation({
    summary: 'Add one of the host\'s published events to a community',
    description: [
      'Attaches a PUBLISHED event that belongs to the calling host to this community as a MANUAL link.',
      'Caller must be an ACTIVE member of the community (403 otherwise).',
      'Idempotent — re-adding an already-linked event upgrades it to MANUAL source.',
    ].join('\n'),
  })
  @ApiOkResponse({
    description: '{ success: true, communityId, eventId }',
    schema: {
      example: { success: true, communityId: '3fa85f64-5717-4562-b3fc-2c963f66afa6', eventId: 'evt-uuid' },
    },
  })
  addEventAsHost(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser('id') userId: string,
    @Body() dto: AddCommunityEventDto,
  ) {
    return this.communitiesService.addEventAsHost(communityId, userId, dto);
  }

  @Post(':id/save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save a community (idempotent)' })
  @ApiOkResponse({ description: '{ saved: true }' })
  saveCommunity(@Param('id', ParseUUIDPipe) id: string, @GetUser('uid') firebaseUid: string) {
    return this.communitiesService.saveCommunity(id, firebaseUid);
  }

  @Delete(':id/save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unsave a community (idempotent)' })
  @ApiOkResponse({ description: '{ saved: false }' })
  unsaveCommunity(@Param('id', ParseUUIDPipe) id: string, @GetUser('uid') firebaseUid: string) {
    return this.communitiesService.unsaveCommunity(id, firebaseUid);
  }

  @Get(':slug')
  @Public()
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({ summary: 'Get a published community by slug' })
  @ApiOkResponse({ description: 'Community detail. Includes `isMember: boolean` (true when the authenticated caller is an ACTIVE or PENDING member; always false for unauthenticated requests).' })
  findBySlug(@Param('slug') slug: string, @GetUser('uid') firebaseUid: string | null) {
    return this.communitiesService.findBySlug(slug, firebaseUid);
  }

  @Post(':id/join')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Join a community (or request access)',
    description: [
      'The caller must supply a `profileVisibility` choice and set `guidelinesAccepted: true`. Sending `false` returns 400 immediately.',
      '**Response `status` field:**',
      '- `ACTIVE` — community access is PUBLIC; membership is granted immediately.',
      '- `PENDING` — community requires approval; a join request is created and must be approved by an admin.',
      'A `ConsentRecord` is written server-side for the guidelines acceptance (DPDP audit trail).',
    ].join('\n\n'),
  })
  @ApiOkResponse({
    description: 'Join result with community summary for the welcome modal. `status` is ACTIVE or PENDING depending on the community\'s access policy.',
    schema: {
      example: {
        status: 'ACTIVE',
        profileVisibility: 'EVENT_ATTENDEES_ONLY',
        community: {
          id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          name: 'Meetday Music Nights',
          slug: 'meetday-music-nights',
          memberCount: 1600,
          experienceCount: 12,
          primaryCity: 'Kolkata',
          iconUrl: 'https://cdn.example.com/seed/communities/music/icon.png',
        },
      },
    },
  })
  join(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('uid') firebaseUid: string,
    @Body() dto: JoinCommunityDto,
    @Req() req: Request,
  ) {
    return this.communitiesService.join(id, firebaseUid, dto, req.ip, req.headers['user-agent'] as string);
  }

  @Delete(':id/leave')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Leave a community the authenticated user belongs to' })
  @ApiOkResponse({ description: '{ success: true }' })
  leave(@Param('id', ParseUUIDPipe) id: string, @GetUser('uid') firebaseUid: string) {
    return this.communitiesService.leave(id, firebaseUid);
  }
}
