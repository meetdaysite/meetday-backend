import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
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

@ApiTags('Spaces')
@ApiBearerAuth('firebase-token')
@UseGuards(RolesGuard)
@Roles('SPACE_PARTNER')
@Controller('spaces')
export class SpacesController {
  constructor(private readonly spacesService: SpacesService) {}

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
  acceptChatRequest(@GetUser('id') userId: string, @Param('interestId', ParseUUIDPipe) interestId: string) {
    return this.spacesService.acceptSpaceInterest(userId, interestId);
  }

  @Post('chats/:interestId/decline')
  @Roles('SPACE_PARTNER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Decline an interest request' })
  @ApiOkResponse({ description: 'Request declined.' })
  declineChatRequest(@GetUser('id') userId: string, @Param('interestId', ParseUUIDPipe) interestId: string) {
    return this.spacesService.declineSpaceInterest(userId, interestId);
  }
}
