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
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { CommunitiesService } from './communities.service';
import { CreateCommunityDto } from './dto/create-community.dto';
import { UpdateCommunityDto } from './dto/update-community.dto';
import { UpdateCommunitySettingsDto } from './dto/update-community-settings.dto';
import { SetCommunityInterestsDto } from './dto/set-community-interests.dto';
import { SetCommunityCitiesDto } from './dto/set-community-cities.dto';
import { AssignMemberDto } from './dto/assign-member.dto';
import { AddCommunityEventDto } from './dto/add-community-event.dto';
import { ListCommunitiesQueryDto } from './dto/list-communities-query.dto';

@ApiTags('Communities (Admin)')
@ApiBearerAuth('firebase-token')
@UseGuards(RolesGuard)
@Roles('SUPER_ADMIN', 'CITY_ADMIN')
@ApiForbiddenResponse({ description: 'Authenticated user does not have a required admin role' })
@Controller('admin/communities')
export class CommunitiesAdminController {
  constructor(private readonly communitiesService: CommunitiesService) {}

  @Get()
  @ApiOperation({ summary: 'List communities (admin)' })
  @ApiOkResponse({ description: 'Paginated list of communities.' })
  list(@Query() query: ListCommunitiesQueryDto) {
    return this.communitiesService.listForAdmin(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a community draft (Step 1)' })
  @ApiCreatedResponse({ description: 'Community draft created; creator is the owner.' })
  create(@GetUser('id') adminId: string, @Body() dto: CreateCommunityDto) {
    return this.communitiesService.create(adminId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get full community detail (admin)' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.communitiesService.findOneForAdmin(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update community top-level fields (Save Draft)' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCommunityDto) {
    return this.communitiesService.update(id, dto);
  }

  @Put(':id/settings')
  @ApiOperation({ summary: 'Update community rules & settings (Step 2)' })
  updateSettings(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCommunitySettingsDto) {
    return this.communitiesService.updateSettings(id, dto);
  }

  @Put(':id/interests')
  @ApiOperation({ summary: 'Replace community interests (Step 3.1)' })
  setInterests(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetCommunityInterestsDto) {
    return this.communitiesService.setInterests(id, dto);
  }

  @Put(':id/cities')
  @ApiOperation({ summary: 'Set primary + community cities (Step 3.2)' })
  setCities(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetCommunityCitiesDto) {
    return this.communitiesService.setCities(id, dto);
  }

  @Post(':id/members')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Assign a manager/host/moderator role (Step 4)' })
  assignMember(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') adminId: string,
    @Body() dto: AssignMemberDto,
  ) {
    return this.communitiesService.assignMember(id, adminId, dto);
  }

  @Delete(':id/members/:memberId')
  @ApiOperation({ summary: 'Remove a role assignment' })
  removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @GetUser('id') adminId: string,
  ) {
    return this.communitiesService.removeMember(id, adminId, memberId);
  }

  @Post(':id/events')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Manually attach an event (Step 3.4)' })
  addEvent(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') adminId: string,
    @Body() dto: AddCommunityEventDto,
  ) {
    return this.communitiesService.addEvent(id, adminId, dto);
  }

  @Delete(':id/events/:eventId')
  @ApiOperation({ summary: 'Detach an event from the community' })
  removeEvent(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.communitiesService.removeEvent(id, eventId);
  }

  @Post(':id/events/resync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Recompute auto-matched events from cities + interests' })
  resyncEvents(@Param('id', ParseUUIDPipe) id: string) {
    return this.communitiesService.resyncEvents(id);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish the community (Step 5)' })
  publish(@Param('id', ParseUUIDPipe) id: string, @GetUser('id') adminId: string) {
    return this.communitiesService.publish(id, adminId);
  }
}
