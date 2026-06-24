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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommunityRole } from '@prisma/client';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { CommunityChannelService } from './community-channel.service';
import { MinCommunityRole } from '../../common/decorators/min-community-role.decorator';
import { CreateChannelDto } from './dto/create-channel.dto';
import { ReorderChannelsDto } from './dto/reorder-channels.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { CommunityRoleGuard } from '../../common/guards/community-role.guard';

@ApiTags('Community Chat (Admin)')
@ApiBearerAuth('firebase-token')
@UseGuards(FirebaseAuthGuard, CommunityRoleGuard)
@Controller('communities/:communityId/channels')
export class CommunityChatAdminController {
  constructor(private readonly channelService: CommunityChannelService) {}

  @Get()
  @MinCommunityRole(CommunityRole.MANAGER)
  @ApiOperation({ summary: 'List all channels in the community (management view)' })
  list(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser() user: { uid: string; dbUserId?: string },
  ) {
    return this.channelService.list(communityId, user.dbUserId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @MinCommunityRole(CommunityRole.MANAGER)
  @ApiOperation({ summary: 'Create a channel in the community' })
  create(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser() user: { uid: string; dbUserId?: string },
    @Body() dto: CreateChannelDto,
  ) {
    const creatorId = user.dbUserId!;
    return this.channelService.create(communityId, creatorId, dto);
  }

  @Patch('order')
  @HttpCode(HttpStatus.OK)
  @MinCommunityRole(CommunityRole.MANAGER)
  @ApiOperation({ summary: 'Reorder channels' })
  reorder(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Body() dto: ReorderChannelsDto,
  ) {
    return this.channelService.reorder(communityId, dto);
  }

  @Patch(':channelId')
  @HttpCode(HttpStatus.OK)
  @MinCommunityRole(CommunityRole.MANAGER)
  @ApiOperation({ summary: 'Update channel settings, welcome banner, or quick replies' })
  update(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body() dto: UpdateChannelDto,
  ) {
    return this.channelService.update(channelId, communityId, dto);
  }

  @Delete(':channelId')
  @HttpCode(HttpStatus.OK)
  @MinCommunityRole(CommunityRole.MANAGER)
  @ApiOperation({ summary: 'Soft-delete a channel' })
  remove(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @GetUser() user: { uid: string; dbUserId?: string },
  ) {
    return this.channelService.softDelete(channelId, communityId, user.dbUserId!);
  }
}
