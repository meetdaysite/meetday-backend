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
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CommunityRole } from '@prisma/client';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { CommunityChannelService } from './community-channel.service';
import { CommunityChatModerationService } from './community-chat-moderation.service';
import { MinCommunityRole } from '../../common/decorators/min-community-role.decorator';
import { CreateChannelDto } from './dto/create-channel.dto';
import { ReorderChannelsDto } from './dto/reorder-channels.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { AddBlockedLinkDto } from './dto/add-blocked-link.dto';
import { AddKeywordAlertDto } from './dto/add-keyword-alert.dto';
import { IssueWarningDto } from './dto/issue-warning.dto';
import { ListReportsQueryDto } from './dto/list-reports-query.dto';
import { MuteUserDto } from './dto/mute-user.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';
import { CommunityRoleGuard } from '../../common/guards/community-role.guard';

@ApiTags('Community Chat (Admin)')
@ApiBearerAuth('firebase-token')
@UseGuards(FirebaseAuthGuard, CommunityRoleGuard)
@Controller('communities/:communityId/channels')
export class CommunityChatAdminController {
  constructor(
    private readonly channelService: CommunityChannelService,
    private readonly moderationService: CommunityChatModerationService,
  ) {}

  // ─── Channel Management ──────────────────────────────────────────────────

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
    return this.channelService.create(communityId, user.dbUserId!, dto);
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

  // ─── Moderation: Overview ─────────────────────────────────────────────────

  @Get('admin/overview')
  @MinCommunityRole(CommunityRole.MANAGER)
  @ApiOperation({ summary: 'Chat admin dashboard overview — stats, previews, 7-day analytics' })
  getOverview(@Param('communityId', ParseUUIDPipe) communityId: string) {
    return this.moderationService.getAdminOverview(communityId);
  }

  // ─── Moderation: Reports ──────────────────────────────────────────────────

  @Get('admin/reports')
  @MinCommunityRole(CommunityRole.MANAGER)
  @ApiOperation({ summary: 'List reported messages with pagination' })
  listReports(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Query() query: ListReportsQueryDto,
  ) {
    return this.moderationService.listReports(communityId, query);
  }

  @Post('admin/reports/:reportId/resolve')
  @HttpCode(HttpStatus.OK)
  @MinCommunityRole(CommunityRole.MANAGER)
  @ApiOperation({ summary: 'Resolve a report — APPROVED keeps the message, REMOVED deletes it' })
  resolveReport(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @GetUser() user: { uid: string; dbUserId?: string },
    @Body() dto: ResolveReportDto,
  ) {
    return this.moderationService.resolveReport(reportId, communityId, user.dbUserId!, dto);
  }

  // ─── Moderation: Pinned (community-wide) ─────────────────────────────────

  @Get('admin/pinned')
  @MinCommunityRole(CommunityRole.MANAGER)
  @ApiOperation({ summary: 'All pinned messages across every channel in this community' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  listPinned(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.moderationService.listPinnedCommunityWide(
      communityId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  // ─── Moderation: Muted Users ──────────────────────────────────────────────

  @Get('admin/muted')
  @MinCommunityRole(CommunityRole.MANAGER)
  @ApiOperation({ summary: 'List muted users in the community' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  listMuted(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.moderationService.listMutedUsers(
      communityId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Post('admin/muted')
  @HttpCode(HttpStatus.CREATED)
  @MinCommunityRole(CommunityRole.MANAGER)
  @ApiOperation({ summary: 'Mute a user (community-wide or per-channel)' })
  muteUser(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser() user: { uid: string; dbUserId?: string },
    @Body() dto: MuteUserDto,
  ) {
    return this.moderationService.muteUser(communityId, user.dbUserId!, dto);
  }

  @Delete('admin/muted/:userId')
  @HttpCode(HttpStatus.OK)
  @MinCommunityRole(CommunityRole.MANAGER)
  @ApiOperation({ summary: 'Unmute a user (pass ?channelId to unmute from one channel only)' })
  @ApiQuery({ name: 'channelId', required: false, type: String })
  unmuteUser(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @GetUser() user: { uid: string; dbUserId?: string },
    @Query('channelId') channelId?: string,
  ) {
    return this.moderationService.unmuteUser(communityId, userId, user.dbUserId!, channelId);
  }

  // ─── Moderation: Keyword Alerts ───────────────────────────────────────────

  @Get('admin/keywords')
  @MinCommunityRole(CommunityRole.MANAGER)
  @ApiOperation({ summary: 'List keyword alert patterns' })
  listKeywords(@Param('communityId', ParseUUIDPipe) communityId: string) {
    return this.moderationService.listKeywords(communityId);
  }

  @Post('admin/keywords')
  @HttpCode(HttpStatus.CREATED)
  @MinCommunityRole(CommunityRole.MANAGER)
  @ApiOperation({ summary: 'Add a keyword alert' })
  addKeyword(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser() user: { uid: string; dbUserId?: string },
    @Body() dto: AddKeywordAlertDto,
  ) {
    return this.moderationService.addKeyword(communityId, user.dbUserId!, dto);
  }

  @Delete('admin/keywords/:keywordId')
  @HttpCode(HttpStatus.OK)
  @MinCommunityRole(CommunityRole.MANAGER)
  @ApiOperation({ summary: 'Remove a keyword alert' })
  deleteKeyword(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('keywordId', ParseUUIDPipe) keywordId: string,
    @GetUser() user: { uid: string; dbUserId?: string },
  ) {
    return this.moderationService.deleteKeyword(keywordId, communityId, user.dbUserId!);
  }

  // ─── Moderation: Blocked Links ────────────────────────────────────────────

  @Get('admin/blocked-links')
  @MinCommunityRole(CommunityRole.MANAGER)
  @ApiOperation({ summary: 'List blocked link patterns' })
  listBlockedLinks(@Param('communityId', ParseUUIDPipe) communityId: string) {
    return this.moderationService.listBlockedLinks(communityId);
  }

  @Post('admin/blocked-links')
  @HttpCode(HttpStatus.CREATED)
  @MinCommunityRole(CommunityRole.MANAGER)
  @ApiOperation({ summary: 'Add a blocked link pattern' })
  addBlockedLink(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser() user: { uid: string; dbUserId?: string },
    @Body() dto: AddBlockedLinkDto,
  ) {
    return this.moderationService.addBlockedLink(communityId, user.dbUserId!, dto);
  }

  @Delete('admin/blocked-links/:linkId')
  @HttpCode(HttpStatus.OK)
  @MinCommunityRole(CommunityRole.MANAGER)
  @ApiOperation({ summary: 'Remove a blocked link pattern' })
  deleteBlockedLink(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('linkId', ParseUUIDPipe) linkId: string,
    @GetUser() user: { uid: string; dbUserId?: string },
  ) {
    return this.moderationService.deleteBlockedLink(linkId, communityId, user.dbUserId!);
  }

  // ─── Moderation: Content Warnings ────────────────────────────────────────

  @Get('admin/warnings')
  @MinCommunityRole(CommunityRole.MANAGER)
  @ApiOperation({ summary: 'List content warnings issued in this community' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  listWarnings(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.moderationService.listWarnings(
      communityId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Post('admin/warnings')
  @HttpCode(HttpStatus.CREATED)
  @MinCommunityRole(CommunityRole.MANAGER)
  @ApiOperation({ summary: 'Issue a formal content warning to a member' })
  issueWarning(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser() user: { uid: string; dbUserId?: string },
    @Body() dto: IssueWarningDto,
  ) {
    return this.moderationService.issueWarning(communityId, user.dbUserId!, dto);
  }

  @Delete('admin/warnings/:warningId')
  @HttpCode(HttpStatus.OK)
  @MinCommunityRole(CommunityRole.MANAGER)
  @ApiOperation({ summary: 'Revoke a content warning' })
  revokeWarning(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('warningId', ParseUUIDPipe) warningId: string,
    @GetUser() user: { uid: string; dbUserId?: string },
  ) {
    return this.moderationService.revokeWarning(warningId, communityId, user.dbUserId!);
  }
}
