import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommunityRole } from '@prisma/client';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { MinCommunityRole } from '../../common/decorators/min-community-role.decorator';
import { CommunityRoleGuard } from '../../common/guards/community-role.guard';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { CommunityMembersService } from './community-members.service';
import { ListMembersQueryDto } from './dto/list-members-query.dto';

@ApiTags('Community Members')
@ApiBearerAuth('firebase-token')
@UseGuards(FirebaseAuthGuard, CommunityRoleGuard)
@MinCommunityRole(CommunityRole.MEMBER)
@Controller('communities/:communityId/members')
export class CommunityMembersController {
  constructor(private readonly membersService: CommunityMembersService) {}

  @Get()
  @ApiOperation({
    summary: 'List community members (search, filter, sort) — active members only',
    description:
      'Filters: all | online | new | active | attended | hosts. Sorts: recentlyActive (default) | newest | mostActive | alphabetical. ' +
      'Page 1 also returns a `featured` strip (top by activity). PRIVATE members are redacted to name/avatar/role.',
  })
  @ApiOkResponse({ description: 'Paginated member cards + featured strip.' })
  list(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser('dbUserId') viewerId: string,
    @Query() query: ListMembersQueryDto,
  ) {
    return this.membersService.list(communityId, viewerId, query);
  }

  @Get(':userId')
  @ApiOperation({
    summary: 'Member detail card (shared interests/experiences, community activity)',
    description:
      'Respects the member\'s profileVisibility relative to the viewer. EVENT_ATTENDEES_ONLY members show full detail only when the viewer shares an event; PRIVATE members return a basic card.',
  })
  @ApiOkResponse({ description: 'Member detail card.' })
  detail(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @GetUser('dbUserId') viewerId: string,
  ) {
    return this.membersService.detail(communityId, viewerId, userId);
  }
}
