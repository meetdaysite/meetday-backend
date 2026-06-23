import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { OptionalAuthGuard } from '../../common/guards/optional-auth.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { CommunitiesService } from './communities.service';
import { ListCommunitiesQueryDto } from './dto/list-communities-query.dto';
import { ListMembersQueryDto } from './dto/list-members-query.dto';
import { RecommendCommunitiesQueryDto } from './dto/recommend-communities-query.dto';
import { JoinCommunityDto } from './dto/join-community.dto';
import { CommunityEventsQueryDto } from './dto/community-events-query.dto';

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

  @Get(':id/members')
  @Public()
  @ApiOperation({
    summary: 'List active members of a published community',
    description:
      'Returns an empty list when the community settings have memberVisibility set to HIDDEN.',
  })
  @ApiOkResponse({ description: 'Paginated member list.' })
  listMembers(@Param('id', ParseUUIDPipe) id: string, @Query() query: ListMembersQueryDto) {
    return this.communitiesService.listMembers(id, query.page ?? 1, query.limit ?? 20);
  }
}
