import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { StorageService } from '../../common/storage/storage.service'
import { CreateCollaborationMessageDto } from './dto/create-collaboration-message.dto'
import { CommunityCollaborationStatus, Prisma } from '@prisma/client'

@Injectable()
export class CommunityCollaborationService {
  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
  ) {}

  async listApprovedCommunities(userId?: string) {
    let excludeCommunityProfileId: string | undefined
    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          hostProfile: {
            select: {
              communityProfile: { select: { id: true } },
            },
          },
          hostTeamMemberships: {
            where: { status: 'ACTIVE' },
            select: { hostProfile: { select: { communityProfile: { select: { id: true } } } } },
          },
        },
      })
      excludeCommunityProfileId =
        user?.hostProfile?.communityProfile?.id ||
        user?.hostTeamMemberships?.[0]?.hostProfile?.communityProfile?.id
    }

    const where: Prisma.HostCommunityProfileWhereInput = {
      approvalStatus: 'APPROVED',
      isHidden: false,
    }
    if (excludeCommunityProfileId) {
      where.id = { not: excludeCommunityProfileId }
    }

    const profiles = await this.prisma.hostCommunityProfile.findMany({
      where,
      select: {
        id: true,
        hostProfileId: true,
        name: true,
        about: true,
        logoKey: true,
        secondaryImageKey: true,
        size: true,
        avgGuestCount: true,
        experiencesPerYear: true,
        pastEvents: true,
        brandsWorkedWith: true,
        categories: { select: { category: { select: { id: true, name: true } } } },
        hostProfile: {
          select: {
            operatingCities: true,
            socialLinks: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    })

    const signPastEvents = async (pastEvents: any) => {
      if (!pastEvents || !Array.isArray(pastEvents)) return []
      return Promise.all(
        pastEvents.map(async (event: any) => ({
          name: event?.name ?? null,
          description: event?.description ?? null,
          imageKeys: event?.imageKeys ?? [],
          imageUrls: await Promise.all(
            (event?.imageKeys ?? []).map((key: string) => this.storageService.getPresignedDownloadUrl(key)),
          ),
        })),
      )
    }

    const signBrands = async (brandsWorkedWith: any) => {
      if (!brandsWorkedWith || !Array.isArray(brandsWorkedWith)) return []
      return Promise.all(
        brandsWorkedWith.map(async (b: any) => ({
          brandName: b?.brandName ?? null,
          logoKey: b?.logoKey ?? null,
          logoUrl: b?.logoKey ? await this.storageService.getPresignedDownloadUrl(b.logoKey) : null,
        })),
      )
    }

    const communities = await Promise.all(
      profiles.map(async ({ logoKey, secondaryImageKey, categories, hostProfile, pastEvents, brandsWorkedWith, ...rest }) => ({
        ...rest,
        logoUrl: logoKey ? await this.storageService.getPresignedDownloadUrl(logoKey) : null,
        secondaryImageUrl: secondaryImageKey ? await this.storageService.getPresignedDownloadUrl(secondaryImageKey) : null,
        categories: categories.map((c) => c.category),
        operatingCities: hostProfile?.operatingCities ?? [],
        socialLinks: hostProfile?.socialLinks ?? null,
        pastEvents: await signPastEvents(pastEvents),
        brandsWorkedWith: await signBrands(brandsWorkedWith),
      })),
    )

    return { communities, total: communities.length }
  }

  async markCollaborationInterest(communityId: string, targetCommunityId: string, userId: string) {
    const requesterProfile = await this.prisma.hostCommunityProfile.findFirst({
      where: {
        OR: [{ id: communityId }, { hostProfileId: communityId }],
      },
      include: { hostProfile: true },
    })

    if (!requesterProfile) {
      throw new NotFoundException('Requester community not found')
    }

    const targetProfile = await this.prisma.hostCommunityProfile.findFirst({
      where: {
        OR: [{ id: targetCommunityId }, { hostProfileId: targetCommunityId }],
        approvalStatus: 'APPROVED',
        isHidden: false,
      },
    })

    if (!targetProfile) {
      throw new NotFoundException('Target community not found')
    }

    if (requesterProfile.id === targetProfile.id) {
      throw new BadRequestException('Cannot collaborate with yourself')
    }

    const existing = await this.prisma.communityCollaborationInterest.findFirst({
      where: {
        OR: [
          { requesterCommunityId: requesterProfile.id, targetCommunityId: targetProfile.id },
          { requesterCommunityId: targetProfile.id, targetCommunityId: requesterProfile.id },
        ],
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
        requesterCommunityId: requesterProfile.id,
        targetCommunityId: targetProfile.id,
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
    // Resolve canonical communityProfile id if hostProfileId was passed
    const canonicalProfile = await this.prisma.hostCommunityProfile.findFirst({
      where: {
        OR: [{ id: communityId }, { hostProfileId: communityId }],
      },
      select: { id: true },
    })
    const resolvedId = canonicalProfile?.id || communityId

    const whereClause: any = {
      OR: [
        { requesterCommunityId: resolvedId },
        { targetCommunityId: resolvedId },
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
        chatMessages: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true, mediaKey: true, createdAt: true },
        },
      },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
    })

    return Promise.all(
      chats.map(async (chat) => {
        const isRequester = chat.requesterCommunityId === resolvedId
        const counterpart = isRequester ? chat.targetCommunity : chat.requesterCommunity
        const myLastReadAt = isRequester ? chat.requesterLastReadAt : chat.targetLastReadAt

        const unreadCount = await this.prisma.communityCollaborationMessage.count({
          where: {
            communityCollaborationId: chat.id,
            deletedAt: null,
            senderType: isRequester ? 'TARGET' : 'REQUESTER',
            ...(myLastReadAt ? { createdAt: { gt: myLastReadAt } } : {}),
          },
        })

        const lastMsg = chat.chatMessages[0]
        const lastMessagePreview = lastMsg
          ? lastMsg.content || (lastMsg.mediaKey ? '📎 Attachment' : '')
          : null

        const counterpartAvatarUrl = counterpart?.logoKey
          ? await this.storageService.getPresignedDownloadUrl(counterpart.logoKey)
          : null

        return {
          id: chat.id,
          requesterCommunityId: chat.requesterCommunityId,
          targetCommunityId: chat.targetCommunityId,
          communityId: counterpart?.id,
          hostId: counterpart?.hostProfileId,
          counterpartCommunityId: counterpart?.id,
          counterpartHostProfileId: counterpart?.hostProfileId,
          mySenderType: isRequester ? 'REQUESTER' : 'TARGET',
          direction: isRequester ? 'OUTGOING' : 'INCOMING',
          communityName: counterpart?.name ?? '',
          hostName: counterpart?.name ?? '',
          counterpartName: counterpart?.name ?? '',
          communityAvatarUrl: counterpartAvatarUrl,
          hostAvatarUrl: counterpartAvatarUrl,
          counterpartAvatarUrl,
          chatStatus: chat.chatStatus,
          lastMessagePreview,
          lastMessageAt: chat.lastMessageAt || chat.createdAt,
          createdAt: chat.createdAt,
          unreadCount,
        }
      }),
    )
  }

  async getCommunityCollaborationChatMessages(interestId: string, communityId: string, userId?: string) {
    const canonicalProfile = await this.prisma.hostCommunityProfile.findFirst({
      where: {
        OR: [{ id: communityId }, { hostProfileId: communityId }],
      },
      select: { id: true },
    })
    const resolvedId = canonicalProfile?.id || communityId

    const interest = await this.prisma.communityCollaborationInterest.findUnique({
      where: { id: interestId },
      include: {
        requesterCommunity: true,
        targetCommunity: true,
      },
    })

    if (!interest) {
      throw new NotFoundException('Collaboration chat not found')
    }

    const isRequester = interest.requesterCommunityId === resolvedId
    const isTarget = interest.targetCommunityId === resolvedId
    if (!isRequester && !isTarget) {
      throw new BadRequestException('Community is not part of this collaboration')
    }

    // Update read timestamp
    await this.prisma.communityCollaborationInterest.update({
      where: { id: interestId },
      data: isRequester ? { requesterLastReadAt: new Date() } : { targetLastReadAt: new Date() },
    })

    const rawMessages = await this.prisma.communityCollaborationMessage.findMany({
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

    const messages = await Promise.all(
      rawMessages.map(async (msg) => ({
        id: msg.id,
        communityCollaborationId: msg.communityCollaborationId,
        senderType: msg.senderType,
        senderId: msg.senderId,
        sender: msg.sender,
        messageType: msg.messageType,
        content: msg.content,
        mediaKey: msg.mediaKey,
        mediaUrl: msg.mediaKey ? await this.storageService.getPresignedDownloadUrl(msg.mediaKey) : null,
        replyToId: msg.replyToId,
        replyTo: msg.replyTo,
        deletedAt: msg.deletedAt,
        createdAt: msg.createdAt,
      })),
    )

    const counterpart = isRequester ? interest.targetCommunity : interest.requesterCommunity
    const counterpartAvatarUrl = counterpart?.logoKey
      ? await this.storageService.getPresignedDownloadUrl(counterpart.logoKey)
      : null

    return {
      messages,
      chatStatus: interest.chatStatus,
      mySenderType: isRequester ? 'REQUESTER' : 'TARGET',
      counterpartName: counterpart?.name ?? '',
      counterpartAvatarUrl,
    }
  }

  async acceptCollaborationRequest(interestId: string, communityId: string) {
    const canonicalProfile = await this.prisma.hostCommunityProfile.findFirst({
      where: {
        OR: [{ id: communityId }, { hostProfileId: communityId }],
      },
      select: { id: true },
    })
    const resolvedId = canonicalProfile?.id || communityId

    const interest = await this.prisma.communityCollaborationInterest.findUnique({
      where: { id: interestId },
    })

    if (!interest) {
      throw new NotFoundException('Collaboration request not found')
    }

    if (interest.targetCommunityId !== resolvedId) {
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
    const canonicalProfile = await this.prisma.hostCommunityProfile.findFirst({
      where: {
        OR: [{ id: communityId }, { hostProfileId: communityId }],
      },
      select: { id: true },
    })
    const resolvedId = canonicalProfile?.id || communityId

    const interest = await this.prisma.communityCollaborationInterest.findUnique({
      where: { id: interestId },
    })

    if (!interest) {
      throw new NotFoundException('Collaboration request not found')
    }

    if (interest.targetCommunityId !== resolvedId) {
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
    const canonicalProfile = await this.prisma.hostCommunityProfile.findFirst({
      where: {
        OR: [{ id: communityId }, { hostProfileId: communityId }],
      },
      select: { id: true },
    })
    const resolvedId = canonicalProfile?.id || communityId

    const interest = await this.prisma.communityCollaborationInterest.findUnique({
      where: { id: interestId },
    })

    if (!interest) {
      throw new NotFoundException('Collaboration chat not found')
    }

    if (interest.chatStatus !== 'ACCEPTED') {
      throw new BadRequestException('Chat is not active yet')
    }

    const isRequester = interest.requesterCommunityId === resolvedId
    const isTarget = interest.targetCommunityId === resolvedId
    if (!isRequester && !isTarget) {
      throw new BadRequestException('Community is not part of this collaboration')
    }

    const message = await this.prisma.communityCollaborationMessage.create({
      data: {
        communityCollaborationId: interestId,
        senderType: isRequester ? 'REQUESTER' : 'TARGET',
        senderId: userId,
        content: payload.content || '',
        mediaKey: payload.mediaKey,
        replyToId: payload.replyToId,
      },
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
    })

    await this.prisma.communityCollaborationInterest.update({
      where: { id: interestId },
      data: {
        lastMessageAt: new Date(),
        ...(isRequester ? { requesterLastReadAt: new Date() } : { targetLastReadAt: new Date() }),
      },
    })

    const mediaUrl = message.mediaKey
      ? await this.storageService.getPresignedDownloadUrl(message.mediaKey)
      : null

    return {
      ...message,
      mediaUrl,
    }
  }

  async getCommunityCollaborationChatByPartner(communityId: string, partnerId: string) {
    const [myProfile, partnerProfile] = await Promise.all([
      this.prisma.hostCommunityProfile.findFirst({
        where: { OR: [{ id: communityId }, { hostProfileId: communityId }] },
        select: { id: true },
      }),
      this.prisma.hostCommunityProfile.findFirst({
        where: { OR: [{ id: partnerId }, { hostProfileId: partnerId }] },
        select: { id: true, name: true, logoKey: true, hostProfileId: true },
      }),
    ])

    const myId = myProfile?.id || communityId
    const targetId = partnerProfile?.id || partnerId

    const chat = await this.prisma.communityCollaborationInterest.findFirst({
      where: {
        OR: [
          { requesterCommunityId: myId, targetCommunityId: targetId },
          { requesterCommunityId: targetId, targetCommunityId: myId },
        ],
      },
    })

    if (!chat) {
      return null
    }

    const isRequester = chat.requesterCommunityId === myId
    const counterpartId = isRequester ? chat.targetCommunityId : chat.requesterCommunityId
    const counterpart =
      partnerProfile?.id === counterpartId
        ? partnerProfile
        : await this.prisma.hostCommunityProfile.findUnique({
            where: { id: counterpartId },
            select: { id: true, name: true, logoKey: true, hostProfileId: true },
          })

    const counterpartAvatarUrl = counterpart?.logoKey
      ? await this.storageService.getPresignedDownloadUrl(counterpart.logoKey)
      : null

    return {
      id: chat.id,
      requesterCommunityId: chat.requesterCommunityId,
      targetCommunityId: chat.targetCommunityId,
      communityId: counterpart?.id,
      hostId: counterpart?.hostProfileId,
      counterpartCommunityId: counterpart?.id,
      counterpartHostProfileId: counterpart?.hostProfileId,
      mySenderType: isRequester ? 'REQUESTER' : 'TARGET',
      direction: isRequester ? 'OUTGOING' : 'INCOMING',
      communityName: counterpart?.name ?? '',
      hostName: counterpart?.name ?? '',
      counterpartName: counterpart?.name ?? '',
      communityAvatarUrl: counterpartAvatarUrl,
      hostAvatarUrl: counterpartAvatarUrl,
      counterpartAvatarUrl,
      chatStatus: chat.chatStatus,
      createdAt: chat.createdAt,
    }
  }
}
