import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common'
import { CommunityCollaborationStatus } from '@prisma/client'
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard'
import { CreateCollaborationMessageDto } from '../community-collaboration/dto/create-collaboration-message.dto'
import { BrandCommunityCollaborationService } from './brand-community-collaboration.service'

@Controller('brand-community-collaboration')
@UseGuards(FirebaseAuthGuard)
export class BrandCommunityCollaborationController {
  constructor(private readonly service: BrandCommunityCollaborationService) {}

  @Get('communities')
  listCommunities() { return this.service.listCommunities() }

  @Post('interest/:targetCommunityId')
  async markInterest(@Param('targetCommunityId') targetCommunityId: string, @Request() req: any) {
    const identity = await this.service.getIdentityByFirebaseUid(req.user.uid)
    return this.service.markInterest(targetCommunityId, identity.id)
  }

  @Get('chats')
  async getChats(@Request() req: any, @Query('status') status?: CommunityCollaborationStatus, @Query('asRole') asRole?: 'BRAND' | 'COMMUNITY') {
    const identity = await this.service.getIdentityByFirebaseUid(req.user.uid)
    return this.service.getChats(identity.id, status, asRole)
  }

  @Get('chats/:interestId/messages')
  async getMessages(@Param('interestId') interestId: string, @Request() req: any, @Query('asRole') asRole?: 'BRAND' | 'COMMUNITY') {
    const identity = await this.service.getIdentityByFirebaseUid(req.user.uid)
    return this.service.getMessages(interestId, identity.id, asRole)
  }

  @Post('chats/:interestId/accept')
  async accept(@Param('interestId') interestId: string, @Request() req: any, @Query('asRole') asRole?: 'BRAND' | 'COMMUNITY') {
    const identity = await this.service.getIdentityByFirebaseUid(req.user.uid)
    return this.service.accept(interestId, identity.id, asRole)
  }

  @Post('chats/:interestId/decline')
  async decline(@Param('interestId') interestId: string, @Request() req: any, @Query('asRole') asRole?: 'BRAND' | 'COMMUNITY') {
    const identity = await this.service.getIdentityByFirebaseUid(req.user.uid)
    return this.service.decline(interestId, identity.id, asRole)
  }

  @Post('chats/:interestId/messages')
  async sendMessage(@Param('interestId') interestId: string, @Body() dto: CreateCollaborationMessageDto, @Request() req: any, @Query('asRole') asRole?: 'BRAND' | 'COMMUNITY') {
    const identity = await this.service.getIdentityByFirebaseUid(req.user.uid)
    return this.service.sendMessage(interestId, identity.id, dto, asRole)
  }
}
