import { Controller, Post, Get, Param, Body, UseGuards, Request, Query, UnauthorizedException } from '@nestjs/common'
import { CommunityCollaborationService } from './community-collaboration.service'
import { CreateCollaborationMessageDto } from './dto/create-collaboration-message.dto'
import { CommunityCollaborationStatus } from '@prisma/client'
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard'
import { PrismaService } from '../../prisma/prisma.service'

@Controller('community-collaboration')
@UseGuards(FirebaseAuthGuard)
export class CommunityCollaborationController {
  constructor(
    private readonly service: CommunityCollaborationService,
    private readonly prisma: PrismaService,
  ) {}

  private async getCommunityContext(req: any): Promise<{ communityId: string; userId: string }> {
    const user = await this.prisma.user.findUnique({
      where: { firebaseUid: req.user.uid },
      select: { id: true, hostProfile: { select: { communityProfile: { select: { id: true } } } } },
    })
    const communityId = user?.hostProfile?.communityProfile?.id
    if (!user || !communityId) throw new UnauthorizedException('Community profile required')
    return { communityId, userId: user.id }
  }

  @Post('interest/:targetCommunityId')
  async markInterest(@Param('targetCommunityId') targetCommunityId: string, @Request() req: any) {
    const { communityId, userId } = await this.getCommunityContext(req)
    return this.service.markCollaborationInterest(communityId, targetCommunityId, userId)
  }

  @Get('chats')
  async getChats(@Request() req: any, @Query('status') status?: CommunityCollaborationStatus) {
    const { communityId } = await this.getCommunityContext(req)
    return this.service.getMyCommunityCollaborationChats(communityId, status)
  }

  @Get('chats/:interestId/messages')
  async getMessages(@Param('interestId') interestId: string, @Request() req: any) {
    const { communityId } = await this.getCommunityContext(req)
    return this.service.getCommunityCollaborationChatMessages(interestId, communityId)
  }

  @Post('chats/:interestId/accept')
  async acceptRequest(@Param('interestId') interestId: string, @Request() req: any) {
    const { communityId } = await this.getCommunityContext(req)
    return this.service.acceptCollaborationRequest(interestId, communityId)
  }

  @Post('chats/:interestId/decline')
  async declineRequest(@Param('interestId') interestId: string, @Request() req: any) {
    const { communityId } = await this.getCommunityContext(req)
    return this.service.declineCollaborationRequest(interestId, communityId)
  }

  @Post('chats/:interestId/messages')
  async sendMessage(
    @Param('interestId') interestId: string,
    @Body() payload: CreateCollaborationMessageDto,
    @Request() req: any,
  ) {
    const { communityId, userId } = await this.getCommunityContext(req)
    return this.service.sendCollaborationMessage(interestId, communityId, userId, payload)
  }

  @Get('chats/partner/:partnerId')
  async getChatByPartner(@Param('partnerId') partnerId: string, @Request() req: any) {
    const { communityId } = await this.getCommunityContext(req)
    return this.service.getCommunityCollaborationChatByPartner(communityId, partnerId)
  }
}
