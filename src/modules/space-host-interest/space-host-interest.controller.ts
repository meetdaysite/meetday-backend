import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { SpaceHostInterestService } from './space-host-interest.service';
import { CreateSpaceHostInterestDto } from './dto/create-space-host-interest.dto';
import { ListSpaceHostChatsQueryDto } from './dto/list-space-host-chats-query.dto';
import { SendSpaceHostChatMessageDto } from './dto/send-space-host-chat-message.dto';
import { UpsertSpaceHostDealDto } from './dto/upsert-space-host-deal.dto';
import { RequestSpaceHostDealChangesDto } from './dto/request-space-host-deal-changes.dto';
import { UpsertSpaceHostDealReportDto } from './dto/upsert-space-host-deal-report.dto';

@ApiTags('Space Host Interests')
@ApiBearerAuth('firebase-token')
@UseGuards(RolesGuard)
@Controller('space-host')
export class SpaceHostInterestController {
  constructor(private readonly service: SpaceHostInterestService) {}

  @Post('communities/:hostProfileId/interest')
  @Roles('SPACE_PARTNER')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Express interest in partnering with a Community',
    description: 'Notifies the community. Idempotent — calling again just returns the existing request.',
  })
  @ApiOkResponse({ description: 'Interest recorded.' })
  markInterest(
    @GetUser('id') userId: string,
    @Param('hostProfileId', ParseUUIDPipe) hostProfileId: string,
    @Body() dto: CreateSpaceHostInterestDto,
  ) {
    return this.service.markInterest(userId, hostProfileId, dto);
  }

  @Get('chats')
  @Roles('HOST', 'SPACE_PARTNER')
  @ApiOperation({
    summary: 'List my Space<->Community partnership chat threads',
    description: 'A space partner sees one thread per community they expressed interest in; a community sees one per interested space.',
  })
  @ApiOkResponse({ description: 'List of chat threads.' })
  listMyChats(@GetUser('id') userId: string, @Query() query: ListSpaceHostChatsQueryDto) {
    return this.service.listMyChats(userId, query);
  }

  @Get('chats/:interestId/messages')
  @Roles('HOST', 'SPACE_PARTNER')
  @ApiOperation({ summary: 'List messages in a partnership chat thread' })
  @ApiOkResponse({ description: 'Messages, oldest first.' })
  listChatMessages(
    @GetUser('id') userId: string,
    @Param('interestId', ParseUUIDPipe) interestId: string,
    @Query('role') role?: 'HOST' | 'SPACE',
  ) {
    return this.service.listChatMessages(userId, interestId, role);
  }

  @Post('chats/:interestId/messages')
  @Roles('HOST', 'SPACE_PARTNER')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Send a chat message', description: 'Only allowed once the community has accepted the request.' })
  @ApiOkResponse({ description: 'Message sent.' })
  sendChatMessage(@GetUser('id') userId: string, @Param('interestId', ParseUUIDPipe) interestId: string, @Body() dto: SendSpaceHostChatMessageDto) {
    return this.service.sendChatMessage(userId, interestId, dto);
  }

  @Post('chats/:interestId/accept')
  @Roles('HOST')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept an interest request and open the chat' })
  @ApiOkResponse({ description: 'Request accepted.' })
  acceptChatRequest(@GetUser('id') userId: string, @Param('interestId', ParseUUIDPipe) interestId: string, @Query('role') role?: 'HOST' | 'SPACE') {
    return this.service.acceptInterest(userId, interestId, role);
  }

  @Post('chats/:interestId/decline')
  @Roles('HOST')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Decline an interest request' })
  @ApiOkResponse({ description: 'Request declined.' })
  declineChatRequest(@GetUser('id') userId: string, @Param('interestId', ParseUUIDPipe) interestId: string, @Query('role') role?: 'HOST' | 'SPACE') {
    return this.service.declineInterest(userId, interestId, role);
  }

  // ── Deal Lock: space fills in terms, community approves ─────────────────────────────────

  @Get('chats/:interestId/deal')
  @Roles('HOST', 'SPACE_PARTNER')
  @ApiOperation({ summary: 'Get the negotiated deal for this chat, if any' })
  @ApiOkResponse({ description: 'The deal, or null.' })
  getDeal(@GetUser('id') userId: string, @Param('interestId', ParseUUIDPipe) interestId: string) {
    return this.service.getDeal(userId, interestId);
  }

  @Post('chats/:interestId/deal')
  @Roles('SPACE_PARTNER')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Lock in deal terms', description: 'Only the space can create the deal; chat must already be accepted.' })
  @ApiOkResponse({ description: 'Deal created.' })
  createDeal(@GetUser('id') userId: string, @Param('interestId', ParseUUIDPipe) interestId: string, @Body() dto: UpsertSpaceHostDealDto) {
    return this.service.createDeal(userId, interestId, dto);
  }

  @Put('chats/:interestId/deal')
  @Roles('SPACE_PARTNER')
  @ApiOperation({ summary: 'Edit deal terms', description: 'Only the space can edit; resets status to PENDING_APPROVAL.' })
  @ApiOkResponse({ description: 'Deal updated.' })
  updateDeal(@GetUser('id') userId: string, @Param('interestId', ParseUUIDPipe) interestId: string, @Body() dto: UpsertSpaceHostDealDto) {
    return this.service.updateDeal(userId, interestId, dto);
  }

  @Post('chats/:interestId/deal/approve')
  @Roles('HOST')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve and lock the deal', description: 'Only the community can approve.' })
  @ApiOkResponse({ description: 'Deal approved.' })
  approveDeal(@GetUser('id') userId: string, @Param('interestId', ParseUUIDPipe) interestId: string, @Query('role') role?: 'HOST' | 'SPACE') {
    return this.service.approveDeal(userId, interestId, role);
  }

  @Post('chats/:interestId/deal/request-changes')
  @Roles('HOST')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request changes to the deal', description: 'Only the community can request changes.' })
  @ApiOkResponse({ description: 'Deal marked as needing changes.' })
  requestDealChanges(
    @GetUser('id') userId: string,
    @Param('interestId', ParseUUIDPipe) interestId: string,
    @Body() dto: RequestSpaceHostDealChangesDto,
  ) {
    return this.service.requestDealChanges(userId, interestId, dto);
  }

  // ── Submit Report: space reports on completed deliverables once the deal is locked ──────

  @Get('chats/:interestId/deal/report')
  @Roles('HOST', 'SPACE_PARTNER')
  @ApiOperation({ summary: 'Get the submitted deliverables report for a locked deal, if any' })
  @ApiOkResponse({ description: 'Report, or null if none has been submitted yet.' })
  getDealReport(@GetUser('id') userId: string, @Param('interestId', ParseUUIDPipe) interestId: string, @Query('role') role?: 'HOST' | 'SPACE') {
    return this.service.getDealReport(userId, interestId, role);
  }

  @Put('chats/:interestId/deal/report')
  @Roles('HOST', 'SPACE_PARTNER')
  @ApiOperation({
    summary: 'Submit/resubmit the deliverables report (space), or approve / request revision (community)',
    description: 'Only enabled once the deal is APPROVED/locked. Community can only act on an already-submitted report.',
  })
  @ApiOkResponse({ description: 'Report saved.' })
  upsertDealReport(@GetUser('id') userId: string, @Param('interestId', ParseUUIDPipe) interestId: string, @Body() dto: UpsertSpaceHostDealReportDto) {
    return this.service.upsertDealReport(userId, interestId, dto);
  }
}
