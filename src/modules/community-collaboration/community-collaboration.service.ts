import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { CreateCollaborationMessageDto } from './dto/create-collaboration-message.dto'
import { CommunityCollaborationStatus } from '@prisma/client'

@Injectable()
export class CommunityCollaborationService {
  constructor(private prisma: PrismaService) {}

  async markCollaborationInterest(communityId: string, targetCommunityId: string, userId: string) {
    if (communityId === targetCommunityId) {
      throw new BadRequestException('Cannot collaborate with yourself')
    }

    const requesterProfile = await this.prisma.hostCommunityProfile.findUnique({
      where: { id: communityId },
      include: { hostProfile: true },
    })

    if (!requesterProfile) {
      throw new NotFoundException('Requester community not found')
    }

    const targetProfile = await this.prisma.hostCommunityProfile.findFirst({
      where: { id: targetCommunityId, approvalStatus: 'APPROVED', isHidden: false },
    })

    if (!targetProfile) {
      throw new NotFoundException('Target community not found')
    }

    const existing = await this.prisma.communityCollaborationInterest.findUnique({
      where: {
        requesterCommunityId_targetCommunityId: {
          requesterCommunityId: communityId,
          targetCommunityId: targetCommunityId,
        },
      },
    })

    if (existing) {
      return {
        message: 'Collaboration request already exists',
        alreadyInterested: true,
        interestId: existing.id,
        chatStatus: existing.chatStatus,
      }
    }

    const interest = await this.prisma.communityCollaborationInterest.create({
      data: {
        requesterCommunityId: communityId,
        targetCommunityId: targetCommunityId,
        chatStatus: 'REQUESTED',
      },
    })

    return {
      message: 'Collaboration request sent',
      alreadyInterested: false,
      interestId: interest.id,
      chatStatus: interest.chatStatus,
    }
  }

  async getMyCommunityCollaborationChats(communityId: string, status?: CommunityCollaborationStatus) {
    const whereClause: any = {
      OR: [
        { requesterCommunityId: communityId },
        { targetCommunityId: communityId },
      ],
    }

    if (status) {
      whereClause.chatStatus = status
    }

    const chats = await this.prisma.communityCollaborationInterest.findMany({
      where: whereClause,
      include: {
        requesterCommunity: {
          include: { hostProfile: true },
        },
        targetCommunity: {
          include: { hostProfile: true },
        },
      },
      orderBy: { lastMessageAt: 'desc' },
    })

    return chats.map(chat => {
      const isRequester = chat.requesterCommunityId === communityId
      const counterpart = isRequester ? chat.targetCommunity : chat.requesterCommunity

      return {
        id: chat.id,
        communityId: isRequester ? chat.requesterCommunityId : chat.targetCommunityId,
        hostId: isRequester ? chat.targetCommunityId : chat.requesterCommunityId,
        mySenderType: isRequester ? 'REQUESTER' : 'TARGET',
        communityName: counterpart.name,
        hostName: counterpart.name,
        communityAvatarUrl: counterpart.logoKey ?? null,
        hostAvatarUrl: counterpart.logoKey ?? null,
        chatStatus: chat.chatStatus,
        lastMessagePreview: null,
        lastMessageAt: chat.lastMessageAt,
        createdAt: chat.createdAt,
        unreadCount: 0,
      }
    })
  }

  async getCommunityCollaborationChatMessages(interestId: string, communityId: string) {
    const interest = await this.prisma.communityCollaborationInterest.findUnique({
      where: { id: interestId },
    })

    if (!interest) {
      throw new NotFoundException('Collaboration chat not found')
    }

    if (interest.requesterCommunityId !== communityId && interest.targetCommunityId !== communityId) {
      throw new BadRequestException('Community is not part of this collaboration')
    }

    const messages = await this.prisma.communityCollaborationMessage.findMany({
      where: { communityCollaborationId: interestId },
      include: {
        sender: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true },
        },
        replyTo: {
          include: {
            sender: {
              select: { firstName: true, lastName: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    return {
      messages,
      chatStatus: interest.chatStatus,
    }
  }

  async acceptCollaborationRequest(interestId: string, communityId: string) {
    const interest = await this.prisma.communityCollaborationInterest.findUnique({
      where: { id: interestId },
    })

    if (!interest) {
      throw new NotFoundException('Collaboration request not found')
    }

    if (interest.targetCommunityId !== communityId) {
      throw new BadRequestException('Only the target community can accept this request')
    }

    const updated = await this.prisma.communityCollaborationInterest.update({
      where: { id: interestId },
      data: {
        chatStatus: 'ACCEPTED',
        chatAcceptedAt: new Date(),
      },
    })

    return {
      message: 'Collaboration request accepted',
      chatStatus: updated.chatStatus,
    }
  }

  async declineCollaborationRequest(interestId: string, communityId: string) {
    const interest = await this.prisma.communityCollaborationInterest.findUnique({
      where: { id: interestId },
    })

    if (!interest) {
      throw new NotFoundException('Collaboration request not found')
    }

    if (interest.targetCommunityId !== communityId) {
      throw new BadRequestException('Only the target community can decline this request')
    }

    const updated = await this.prisma.communityCollaborationInterest.update({
      where: { id: interestId },
      data: { chatStatus: 'DECLINED' },
    })

    return {
      message: 'Collaboration request declined',
      chatStatus: updated.chatStatus,
    }
  }

  async sendCollaborationMessage(
    interestId: string,
    communityId: string,
    userId: string,
    payload: CreateCollaborationMessageDto,
  ) {
    const interest = await this.prisma.communityCollaborationInterest.findUnique({
      where: { id: interestId },
    })

    if (!interest) {
      throw new NotFoundException('Collaboration chat not found')
    }

    if (interest.chatStatus !== 'ACCEPTED') {
      throw new BadRequestException('Chat is not active yet')
    }

    const isRequester = interest.requesterCommunityId === communityId
    if (!isRequester && interest.targetCommunityId !== communityId) {
      throw new BadRequestException('Community is not part of this collaboration')
    }

    const message = await this.prisma.communityCollaborationMessage.create({
      data: {
        communityCollaborationId: interestId,
        senderType: isRequester ? 'REQUESTER' : 'TARGET',
        senderId: userId,
        content: payload.content,
        mediaKey: payload.mediaKey,
        replyToId: payload.replyToId,
      },
      include: {
        sender: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true },
        },
      },
    })

    await this.prisma.communityCollaborationInterest.update({
      where: { id: interestId },
      data: { lastMessageAt: new Date() },
    })

    return message
  }

  async getCommunityCollaborationChatByPartner(communityId: string, partnerId: string) {
    const chat = await this.prisma.communityCollaborationInterest.findFirst({
      where: {
        chatStatus: 'ACCEPTED',
        OR: [
          {
            requesterCommunityId: communityId,
            targetCommunityId: partnerId,
          },
          {
            requesterCommunityId: partnerId,
            targetCommunityId: communityId,
          },
        ],
      },
    })

    if (!chat) {
      return null
    }

    const isRequester = chat.requesterCommunityId === communityId
    const counterpart = await this.prisma.hostCommunityProfile.findUnique({
      where: {
        id: isRequester ? chat.targetCommunityId : chat.requesterCommunityId,
      },
      include: { hostProfile: true },
    })

    return {
      id: chat.id,
      communityId: isRequester ? chat.requesterCommunityId : chat.targetCommunityId,
      hostId: isRequester ? chat.targetCommunityId : chat.requesterCommunityId,
      mySenderType: isRequester ? 'REQUESTER' : 'TARGET',
      communityName: counterpart?.name,
      hostName: counterpart?.name,
      communityAvatarUrl: counterpart?.logoKey ?? null,
      hostAvatarUrl: counterpart?.logoKey ?? null,
      chatStatus: chat.chatStatus,
      createdAt: chat.createdAt,
    }
  }
}
