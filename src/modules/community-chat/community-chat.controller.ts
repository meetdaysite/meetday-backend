import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommunityRole } from '@prisma/client';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { CommunityChatService } from './community-chat.service';
import { CommunityChatGateway } from './community-chat.gateway';
import { CommunityChannelService } from './community-channel.service';
import { CommunityChatModerationService } from './community-chat-moderation.service';
import { CommunityDmService } from './community-dm.service';
import { CommunityPresenceService } from './community-presence.service';
import { MinCommunityRole } from '../../common/decorators/min-community-role.decorator';
import { MessageCursorQueryDto } from './dto/message-cursor-query.dto';
import { CreateIntroDto } from './dto/create-intro.dto';
import { ReportMessageDto } from './dto/report-message.dto';
import { CommunityRoleGuard } from '../../common/guards/community-role.guard';

@ApiTags('Community Chat')
@ApiBearerAuth('firebase-token')
@UseGuards(FirebaseAuthGuard, CommunityRoleGuard)
@Controller('communities/:communityId')
export class CommunityChatController {
  constructor(
    private readonly channelService: CommunityChannelService,
    private readonly chatService: CommunityChatService,
    private readonly dmService: CommunityDmService,
    private readonly presenceService: CommunityPresenceService,
    private readonly moderationService: CommunityChatModerationService,
    private readonly gateway: CommunityChatGateway,
    private readonly prisma: PrismaService,
  ) {}

  // ─── Channels ──────────────────────────────────────────────────────────────

  @Get('channels')
  @MinCommunityRole(CommunityRole.MEMBER)
  @ApiOperation({ summary: 'List channels with member read state' })
  listChannels(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser() user: { uid: string; dbUserId?: string },
  ) {
    return this.channelService.list(communityId, user.dbUserId);
  }

  // ─── Messages ──────────────────────────────────────────────────────────────

  @Get('channels/:channelId/messages')
  @MinCommunityRole(CommunityRole.MEMBER)
  @ApiOperation({ summary: 'Get paginated message history (cursor-based)' })
  getMessages(
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Query() query: MessageCursorQueryDto,
  ) {
    return this.chatService.getMessageHistory(channelId, query.cursor, query.limit);
  }

  @Get('channels/:channelId/messages/:messageId/replies')
  @MinCommunityRole(CommunityRole.MEMBER)
  @ApiOperation({ summary: 'Get replies for a message thread' })
  getReplies(
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Query() query: MessageCursorQueryDto,
  ) {
    return this.chatService.getReplies(messageId, query.cursor, query.limit);
  }

  @Get('channels/:channelId/pinned')
  @MinCommunityRole(CommunityRole.MEMBER)
  @ApiOperation({ summary: 'Get pinned messages in a channel' })
  getPinnedMessages(@Param('channelId', ParseUUIDPipe) channelId: string) {
    return this.chatService.getPinnedMessages(channelId);
  }

  @Post('channels/:channelId/messages/:messageId/pin')
  @HttpCode(HttpStatus.OK)
  @MinCommunityRole(CommunityRole.MODERATOR)
  @ApiOperation({ summary: 'Pin a message (moderator+)' })
  async pinMessage(
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @GetUser() user: { uid: string; dbUserId?: string },
  ) {
    const message = await this.chatService.pinMessage(messageId, channelId, user.dbUserId!);
    this.gateway.emitToChannel(channelId, 'message-pinned', { channelId, message });
    return message;
  }

  @Delete('channels/:channelId/messages/:messageId/pin')
  @HttpCode(HttpStatus.OK)
  @MinCommunityRole(CommunityRole.MODERATOR)
  @ApiOperation({ summary: 'Unpin a message (moderator+)' })
  async unpinMessage(
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @GetUser() user: { uid: string; dbUserId?: string },
  ) {
    const message = await this.chatService.unpinMessage(messageId, channelId, user.dbUserId!);
    this.gateway.emitToChannel(channelId, 'message-unpinned', { channelId, messageId });
    return message;
  }

  @Delete('channels/:channelId/messages/:messageId')
  @HttpCode(HttpStatus.OK)
  @MinCommunityRole(CommunityRole.MEMBER)
  @ApiOperation({ summary: 'Soft-delete a message (own message or moderator+)' })
  async deleteMessage(
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @GetUser() user: { uid: string; dbUserId?: string; communityRole?: CommunityRole },
  ) {
    const result = await this.chatService.softDeleteMessage(
      messageId,
      channelId,
      user.dbUserId!,
      user.communityRole ?? CommunityRole.MEMBER,
    );
    this.gateway.emitToChannel(channelId, 'message-deleted', { channelId, messageId });
    return result;
  }

  @Post('channels/:channelId/messages/:messageId/report')
  @HttpCode(HttpStatus.CREATED)
  @MinCommunityRole(CommunityRole.MEMBER)
  @ApiOperation({ summary: 'Report a message for moderation review' })
  reportMessage(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @GetUser() user: { uid: string; dbUserId?: string },
    @Body() dto: ReportMessageDto,
  ) {
    return this.moderationService.submitReport(communityId, channelId, messageId, user.dbUserId!, dto);
  }

  @Delete('channels/:channelId/banner/dismiss')
  @HttpCode(HttpStatus.OK)
  @MinCommunityRole(CommunityRole.MEMBER)
  @ApiOperation({ summary: 'Dismiss the welcome banner for this channel' })
  dismissBanner(
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @GetUser() user: { uid: string; dbUserId?: string },
  ) {
    return this.chatService.dismissBanner(channelId, user.dbUserId!);
  }

  // ─── Presence ──────────────────────────────────────────────────────────────

  @Get('presence')
  @MinCommunityRole(CommunityRole.MEMBER)
  @ApiOperation({ summary: 'Get online member count and sample avatars' })
  getPresence(@Param('communityId', ParseUUIDPipe) communityId: string) {
    return this.presenceService.getPresence(communityId);
  }

  // ─── DM Intro Requests ──────────────────────────────────────────────────────

  @Post('dms/intros')
  @HttpCode(HttpStatus.CREATED)
  @MinCommunityRole(CommunityRole.MEMBER)
  @ApiOperation({ summary: 'Send an introduction request to a member (first contact)' })
  async sendIntro(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser() user: { uid: string; dbUserId?: string },
    @Body() dto: CreateIntroDto,
  ) {
    const { targetUserId, ...payload } = dto;
    const result = await this.dmService.createIntro(communityId, user.dbUserId!, targetUserId, payload);
    this.gateway.emitToUser(result.recipientId, 'intro-received', {
      conversationId: result.conversationId,
      fromUser: result.initiator,
    });
    return { conversationId: result.conversationId, message: result.message };
  }

  @Get('dms/intros')
  @MinCommunityRole(CommunityRole.MEMBER)
  @ApiOperation({ summary: 'Received pending intro requests (with shared interests)' })
  listReceivedIntros(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser() user: { uid: string; dbUserId?: string },
  ) {
    return this.dmService.listReceivedIntros(communityId, user.dbUserId!);
  }

  @Get('dms/intros/sent')
  @MinCommunityRole(CommunityRole.MEMBER)
  @ApiOperation({ summary: 'My pending sent intro requests' })
  listSentIntros(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser() user: { uid: string; dbUserId?: string },
  ) {
    return this.dmService.listSentIntros(communityId, user.dbUserId!);
  }

  @Post('dms/intros/:conversationId/accept')
  @HttpCode(HttpStatus.OK)
  @MinCommunityRole(CommunityRole.MEMBER)
  @ApiOperation({ summary: 'Accept an intro request — opens the DM thread' })
  async acceptIntro(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @GetUser() user: { uid: string; dbUserId?: string },
  ) {
    const result = await this.dmService.acceptIntro(conversationId, user.dbUserId!);
    this.gateway.emitToUser(result.initiatorId, 'intro-accepted', {
      conversationId: result.conversationId,
      byUser: result.accepter,
    });
    return { conversationId: result.conversationId };
  }

  @Post('dms/intros/:conversationId/reject')
  @HttpCode(HttpStatus.OK)
  @MinCommunityRole(CommunityRole.MEMBER)
  @ApiOperation({ summary: 'Reject an intro request (silent — initiator is not notified)' })
  rejectIntro(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @GetUser() user: { uid: string; dbUserId?: string },
  ) {
    return this.dmService.rejectIntro(conversationId, user.dbUserId!);
  }

  // ─── Direct Messages ───────────────────────────────────────────────────────

  @Get('dms')
  @MinCommunityRole(CommunityRole.MEMBER)
  @ApiOperation({ summary: 'List DM conversations with unread counts (accepted only)' })
  listDms(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser() user: { uid: string; dbUserId?: string },
  ) {
    return this.dmService.listConversations(communityId, user.dbUserId!);
  }

  @Get('dms/unread-count')
  @MinCommunityRole(CommunityRole.MEMBER)
  @ApiOperation({ summary: 'Total unread DM count for the current user in this community' })
  getDmUnreadCount(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser() user: { uid: string; dbUserId?: string },
  ) {
    return this.dmService.getTotalUnreadDmCount(communityId, user.dbUserId!);
  }

  @Get('dms/:conversationId/messages')
  @MinCommunityRole(CommunityRole.MEMBER)
  @ApiOperation({ summary: 'Get paginated DM message history' })
  getDmHistory(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @GetUser() user: { uid: string; dbUserId?: string },
    @Query() query: MessageCursorQueryDto,
  ) {
    return this.dmService.getDmHistory(conversationId, user.dbUserId!, query.cursor, query.limit);
  }
}
