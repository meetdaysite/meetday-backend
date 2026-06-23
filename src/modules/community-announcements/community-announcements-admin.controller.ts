import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CommunityAnnouncementsService } from './community-announcements.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';

@ApiTags('Community Announcements (Admin)')
@ApiBearerAuth('firebase-token')
@UseGuards(RolesGuard)
@Roles('SUPER_ADMIN', 'CITY_ADMIN')
@ApiForbiddenResponse({ description: 'Authenticated user does not have a required admin role' })
@Controller('admin/communities/:communityId/announcements')
export class CommunityAnnouncementsAdminController {
  constructor(private readonly service: CommunityAnnouncementsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create and publish an announcement (fans out to members)' })
  create(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser('id') adminId: string,
    @Body() dto: CreateAnnouncementDto,
  ) {
    return this.service.create(communityId, adminId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit an announcement' })
  update(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') adminId: string,
    @Body() dto: UpdateAnnouncementDto,
  ) {
    return this.service.update(communityId, id, dto, adminId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete an announcement' })
  remove(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') adminId: string,
  ) {
    return this.service.softDelete(communityId, id, adminId);
  }

  @Post(':id/pin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pin an announcement to the top' })
  pin(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') adminId: string,
  ) {
    return this.service.pin(communityId, id, adminId);
  }

  @Delete(':id/pin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unpin an announcement' })
  unpin(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') adminId: string,
  ) {
    return this.service.unpin(communityId, id, adminId);
  }
}
