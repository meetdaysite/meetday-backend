import { Controller, Post, Get, Param, Body, UseGuards, Request, Query } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { CommunityCollaborationService } from './community-collaboration.service'
import { CreateCollaborationMessageDto } from './dto/create-collaboration-message.dto'
import { CommunityCollaborationStatus } from '@prisma/client'

@Controller('community-collaboration')
@UseGuards(AuthGuard('jwt'))
export class CommunityCollaborationController {
  constructor(private readonly service: CommunityCollaborationService) {}

  @Post('interest/:targetCommunityId')
  async markInterest(@Param('targetCommunityId') targetCommunityId: string, @Request() req: any) {
    const communityId = req.user.communityId // Assumed to be set from JWT
    return this.service.markCollaborationInterest(communityId, targetCommunityId, req.user.id)
  }

  @Get('chats')
  async getChats(@Query('status') status?: CommunityCollaborationStatus, @Request() req: any) {
    const communityId = req.user.communityId
    return this.service.getMyCommunityCollaborationChats(communityId, status)
  }

  @Get('chats/:interestId/messages')
  async getMessages(@Param('interestId') interestId: string, @Request() req: any) {
    const communityId = req.user.communityId
    return this.service.getCommunityCollaborationChatMessages(interestId, communityId)
  }

  @Post('chats/:interestId/accept')
  async acceptRequest(@Param('interestId') interestId: string, @Request() req: any) {
    const communityId = req.user.communityId
    return this.service.acceptCollaborationRequest(interestId, communityId)
  }

  @Post('chats/:interestId/decline')
  async declineRequest(@Param('interestId') interestId: string, @Request() req: any) {
    const communityId = req.user.communityId
    return this.service.declineCollaborationRequest(interestId, communityId)
  }

  @Post('chats/:interestId/messages')
  async sendMessage(
    @Param('interestId') interestId: string,
    @Body() payload: CreateCollaborationMessageDto,
    @Request() req: any,
  ) {
    const communityId = req.user.communityId
    return this.service.sendCollaborationMessage(interestId, communityId, req.user.id, payload)
  }

  @Get('chats/partner/:partnerId')
  async getChatByPartner(@Param('partnerId') partnerId: string, @Request() req: any) {
    const communityId = req.user.communityId
    return this.service.getCommunityCollaborationChatByPartner(communityId, partnerId)
  }
}
