import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { SpacesService } from './spaces.service';
import { UpdateSpaceProfileDto } from './dto/update-space-profile.dto';
import { ActivateSpaceCommunityDto } from './dto/activate-space-community.dto';
import { CreateSpaceInterestDto } from './dto/create-space-interest.dto';
import { ListSpaceChatsQueryDto } from './dto/list-space-chats-query.dto';
import { SendSpaceChatMessageDto } from './dto/send-space-chat-message.dto';
import { UpsertSpaceDealDto } from './dto/upsert-space-deal.dto';
import { RequestSpaceDealChangesDto } from './dto/request-space-deal-changes.dto';
import { UpsertSpaceDealReportDto } from './dto/upsert-space-deal-report.dto';
import { SpaceReportPdfService } from './space-report-pdf.service';

@ApiTags('Spaces')
@ApiBearerAuth('firebase-token')
@UseGuards(RolesGuard)
@Roles('SPACE_PARTNER')
@Controller('spaces')
export class SpacesController {
  constructor(
    private readonly spacesService: SpacesService,
    private readonly spaceReportPdfService: SpaceReportPdfService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: "Get the authenticated space partner's own profile" })
  @ApiOkResponse({ description: 'Space partner profile.' })
  getMe(@GetUser('id') userId: string) {
    return this.spacesService.getMe(userId);
  }

  @Patch('me')
  @ApiOperation({ summary: "Update the authenticated space partner's profile" })
  @ApiOkResponse({ description: 'Updated space partner profile.' })
  updateMe(@GetUser('id') userId: string, @Body() dto: UpdateSpaceProfileDto) {
    return this.spacesService.updateProfile(userId, dto);
  }

  @Get('community')
  @ApiOperation({ summary: "Get the authenticated space partner's Community Space profile" })
  @ApiOkResponse({ description: 'Community Space profile, or null if not yet activated.' })
  getCommunityProfile(@GetUser('id') userId: string) {
    return this.spacesService.getCommunityProfile(userId);
  }

  @Post('community')
  @ApiOperation({
    summary: 'Activate (create/edit) the Community Space profile',
    description:
      'Creates or edits the public-facing Community Space listing. Resets to PENDING for a new/rejected ' +
      'profile; stages edits as a pendingRevision for an already-APPROVED profile.',
  })
  @ApiOkResponse({ description: 'Community Space profile activated/edited.' })
  activateCommunityProfile(@GetUser('id') userId: string, @Body() dto: ActivateSpaceCommunityDto) {
    return this.spacesService.activateCommunityProfile(userId, dto);
  }

  @Delete('community')
  @ApiOperation({ summary: 'Deactivate the Community Space profile' })
  @ApiOkResponse({ description: 'Community Space profile deactivated.' })
  deactivateCommunityProfile(@GetUser('id') userId: string) {
    return this.spacesService.deactivateCommunityProfile(userId);
  }

  @Get('community/browse')
  @Roles('BRAND', 'HOST')
  @ApiOperation({
    summary: 'List onboarded community spaces (brand/community view)',
    description: 'Full info for admin-approved, non-hidden Community Space profiles — for brands and communities to discover.',
  })
  @ApiOkResponse({ description: 'List of onboarded community spaces.' })
  browseCommunitySpaces() {
    return this.spacesService.listApprovedCommunities();
  }

  // ── Interest + Chat (Brand/Community ↔ Space Partner) ───────────────────────────────────
  // Registered before any generic ':id' routes would exist so 'chats' isn't swallowed as one.

  @Post('community/:id/interest')
  @Roles('BRAND', 'HOST')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Express interest in a Community Space',
    description: 'Notifies the space partner. Idempotent — calling again just returns the existing request.',
  })
  @ApiOkResponse({ description: 'Interest recorded.' })
  markInterest(@GetUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateSpaceInterestDto) {
    return this.spacesService.markSpaceInterest(userId, id, dto);
  }

  @Get('chats')
  @Roles('BRAND', 'HOST', 'SPACE_PARTNER')
  @ApiOperation({
    summary: 'List my Community Space chat threads',
    description: 'A brand/community sees one thread per space they expressed interest in; a space sees one per interested brand/community.',
  })
  @ApiOkResponse({ description: 'List of chat threads.' })
  listMyChats(@GetUser('id') userId: string, @Query() query: ListSpaceChatsQueryDto) {
    return this.spacesService.listMySpaceChats(userId, query);
  }

  @Get('chats/:interestId/messages')
  @Roles('BRAND', 'HOST', 'SPACE_PARTNER')
  @ApiOperation({ summary: 'List messages in a Community Space chat thread' })
  @ApiOkResponse({ description: 'Messages, oldest first.' })
  listChatMessages(
    @GetUser('id') userId: string,
    @Param('interestId', ParseUUIDPipe) interestId: string,
    @Query('role') role?: 'BRAND' | 'COMMUNITY' | 'SPACE',
  ) {
    return this.spacesService.listSpaceChatMessages(userId, interestId, role);
  }

  @Post('chats/:interestId/messages')
  @Roles('BRAND', 'HOST', 'SPACE_PARTNER')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Send a chat message', description: 'Only allowed once the space has accepted the request.' })
  @ApiOkResponse({ description: 'Message sent.' })
  sendChatMessage(@GetUser('id') userId: string, @Param('interestId', ParseUUIDPipe) interestId: string, @Body() dto: SendSpaceChatMessageDto) {
    return this.spacesService.sendSpaceChatMessage(userId, interestId, dto);
  }

  @Post('chats/:interestId/accept')
  @Roles('SPACE_PARTNER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept an interest request and open the chat' })
  @ApiOkResponse({ description: 'Request accepted.' })
  acceptChatRequest(
    @GetUser('id') userId: string,
    @Param('interestId', ParseUUIDPipe) interestId: string,
    @Query('role') role?: 'BRAND' | 'COMMUNITY' | 'SPACE',
  ) {
    return this.spacesService.acceptSpaceInterest(userId, interestId, role);
  }

  @Post('chats/:interestId/decline')
  @Roles('SPACE_PARTNER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Decline an interest request' })
  @ApiOkResponse({ description: 'Request declined.' })
  declineChatRequest(
    @GetUser('id') userId: string,
    @Param('interestId', ParseUUIDPipe) interestId: string,
    @Query('role') role?: 'BRAND' | 'COMMUNITY' | 'SPACE',
  ) {
    return this.spacesService.declineSpaceInterest(userId, interestId, role);
  }

  // ── Deal Lock: space fills in terms, counterpart (brand/community) approves ─────────────

  @Get('chats/:interestId/deal')
  @Roles('BRAND', 'HOST', 'SPACE_PARTNER')
  @ApiOperation({ summary: 'Get the negotiated deal for this chat, if any' })
  @ApiOkResponse({ description: 'The deal, or null.' })
  getDeal(@GetUser('id') userId: string, @Param('interestId', ParseUUIDPipe) interestId: string) {
    return this.spacesService.getSpaceDeal(userId, interestId);
  }

  @Post('chats/:interestId/deal')
  @Roles('SPACE_PARTNER')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Lock in deal terms', description: 'Only the space can create the deal; chat must already be accepted.' })
  @ApiOkResponse({ description: 'Deal created.' })
  createDeal(@GetUser('id') userId: string, @Param('interestId', ParseUUIDPipe) interestId: string, @Body() dto: UpsertSpaceDealDto) {
    return this.spacesService.createSpaceDeal(userId, interestId, dto);
  }

  @Put('chats/:interestId/deal')
  @Roles('SPACE_PARTNER')
  @ApiOperation({ summary: 'Edit deal terms', description: 'Only the space can edit; resets status to PENDING_APPROVAL.' })
  @ApiOkResponse({ description: 'Deal updated.' })
  updateDeal(@GetUser('id') userId: string, @Param('interestId', ParseUUIDPipe) interestId: string, @Body() dto: UpsertSpaceDealDto) {
    return this.spacesService.updateSpaceDeal(userId, interestId, dto);
  }

  @Post('chats/:interestId/deal/approve')
  @Roles('BRAND', 'HOST')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve and lock the deal', description: 'Only the counterpart (brand/community) can approve.' })
  @ApiOkResponse({ description: 'Deal approved.' })
  approveDeal(
    @GetUser('id') userId: string,
    @Param('interestId', ParseUUIDPipe) interestId: string,
    @Query('role') role?: 'BRAND' | 'COMMUNITY' | 'SPACE',
  ) {
    return this.spacesService.approveSpaceDeal(userId, interestId, role);
  }

  @Post('chats/:interestId/deal/request-changes')
  @Roles('BRAND', 'HOST')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request changes to the deal', description: 'Only the counterpart (brand/community) can request changes.' })
  @ApiOkResponse({ description: 'Deal marked as needing changes.' })
  requestDealChanges(
    @GetUser('id') userId: string,
    @Param('interestId', ParseUUIDPipe) interestId: string,
    @Body() dto: RequestSpaceDealChangesDto,
  ) {
    return this.spacesService.requestSpaceDealChanges(userId, interestId, dto);
  }

  // ── Submit Report: space reports on completed deliverables once the deal is locked ────

  @Get('chats/:interestId/deal/report')
  @Roles('BRAND', 'HOST', 'SPACE_PARTNER')
  @ApiOperation({ summary: 'Get the submitted deliverables report for a locked deal, if any' })
  @ApiOkResponse({ description: 'Report, or null if none has been submitted yet.' })
  getDealReport(
    @GetUser('id') userId: string,
    @Param('interestId', ParseUUIDPipe) interestId: string,
    @Query('role') role?: 'BRAND' | 'COMMUNITY' | 'SPACE',
  ) {
    return this.spacesService.getSpaceDealReport(userId, interestId, role);
  }

  @Put('chats/:interestId/deal/report')
  @Roles('BRAND', 'HOST', 'SPACE_PARTNER')
  @ApiOperation({
    summary: 'Submit/resubmit the deliverables report (space), or approve / request revision (counterpart)',
    description: 'Only enabled once the deal is APPROVED/locked. Counterpart can only act on an already-submitted report.',
  })
  @ApiOkResponse({ description: 'Report saved.' })
  upsertDealReport(
    @GetUser('id') userId: string,
    @Param('interestId', ParseUUIDPipe) interestId: string,
    @Body() dto: UpsertSpaceDealReportDto,
  ) {
    return this.spacesService.upsertSpaceDealReport(userId, interestId, dto);
  }

  @Get('chats/:interestId/deal/report/pdf')
  @Roles('BRAND', 'HOST', 'SPACE_PARTNER')
  @ApiOperation({ summary: 'Get a presigned download URL for the deliverables report as a PDF' })
  @ApiOkResponse({ description: 'Presigned report PDF URL.' })
  async getDealReportPdfUrl(@GetUser('id') userId: string, @Param('interestId', ParseUUIDPipe) interestId: string) {
    // Reuses getSpaceDeal's participant access check before generating the PDF.
    await this.spacesService.getSpaceDeal(userId, interestId);
    const url = await this.spaceReportPdfService.getDownloadUrl(interestId);
    return { url };
  }
}
