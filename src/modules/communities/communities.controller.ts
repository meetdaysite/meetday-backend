import { Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { OptionalAuthGuard } from '../../common/guards/optional-auth.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { CommunitiesService } from './communities.service';
import { ListCommunitiesQueryDto } from './dto/list-communities-query.dto';
import { ListMembersQueryDto } from './dto/list-members-query.dto';
import { RecommendCommunitiesQueryDto } from './dto/recommend-communities-query.dto';

@ApiTags('Communities')
@ApiBearerAuth('firebase-token')
@Controller('communities')
export class CommunitiesController {
  constructor(private readonly communitiesService: CommunitiesService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Browse published communities' })
  @ApiOkResponse({ description: 'Paginated list of discoverable communities.' })
  browse(@Query() query: ListCommunitiesQueryDto) {
    return this.communitiesService.listPublic(query);
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

  @Get(':slug')
  @Public()
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({ summary: 'Get a published community by slug' })
  findBySlug(@Param('slug') slug: string) {
    return this.communitiesService.findBySlug(slug);
  }

  @Post(':id/join')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Join a community (or request access)' })
  join(@Param('id', ParseUUIDPipe) id: string, @GetUser('uid') firebaseUid: string) {
    return this.communitiesService.join(id, firebaseUid);
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
