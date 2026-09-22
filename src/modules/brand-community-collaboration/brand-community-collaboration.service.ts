import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { CommunityCollaborationStatus } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { StorageService } from '../../common/storage/storage.service'
import { CreateCollaborationMessageDto } from '../community-collaboration/dto/create-collaboration-message.dto'

@Injectable()
export class BrandCommunityCollaborationService {
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService) {}

  async getIdentityByFirebaseUid(firebaseUid: string) {
    const user = await this.prisma.user.findUnique({ where: { firebaseUid }, select: { id: true } })
    if (!user) throw new UnauthorizedException('User not found')
    return user
  }

  async getIdentity(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        brandProfile: { select: { id: true, brandName: true, logoKey: true } },
        hostProfile: { select: { communityProfile: { select: { id: true, name: true, logoKey: true } } } },
        hostTeamMemberships: {
          where: { status: 'ACTIVE' },
          select: { hostProfile: { select: { communityProfile: { select: { id: true, name: true, logoKey: true } } } } },
        },
      },
    })
    if (!user) throw new UnauthorizedException('User not found')
    return {
      user,
      brand: user.brandProfile,
      community: user.hostProfile?.communityProfile || user.hostTeamMemberships[0]?.hostProfile.communityProfile || null,
    }
  }

  async listCommunities() {
    const profiles = await this.prisma.hostCommunityProfile.findMany({
      where: { approvalStatus: 'APPROVED', isHidden: false },
      select: { id: true, hostProfileId: true, name: true, logoKey: true, size: true, about: true },
      orderBy: { updatedAt: 'desc' },
    })
    return {
      communities: await Promise.all(profiles.map(async (profile) => ({
        ...profile,
        logoUrl: profile.logoKey ? await this.storage.getPresignedDownloadUrl(profile.logoKey) : null,
      }))),
      total: profiles.length,
    }
  }

  async markInterest(targetCommunityId: string, brandUserId: string) {
    const { brand } = await this.getIdentity(brandUserId)
    if (!brand) throw new UnauthorizedException('Brand profile required')
    const target = await this.prisma.hostCommunityProfile.findFirst({
      where: { OR: [{ id: targetCommunityId }, { hostProfileId: targetCommunityId }], approvalStatus: 'APPROVED', isHidden: false },
    })
    if (!target) throw new NotFoundException('Community not found')
    const existing = await this.prisma.brandCommunityCollaborationInterest.findUnique({
      where: { requesterBrandId_targetCommunityId: { requesterBrandId: brand.id, targetCommunityId: target.id } },
    })
    if (existing) return { message: 'Collaboration request already exists', alreadyInterested: true, interestId: existing.id, chatStatus: existing.chatStatus }
    const interest = await this.prisma.brandCommunityCollaborationInterest.create({ data: { requesterBrandId: brand.id, targetCommunityId: target.id } })
    return { message: 'Collaboration request sent', alreadyInterested: false, interestId: interest.id, chatStatus: interest.chatStatus }
  }

  private async findForUser(interestId: string, userId: string) {
    const { brand, community } = await this.getIdentity(userId)
    const interest = await this.prisma.brandCommunityCollaborationInterest.findUnique({
      where: { id: interestId },
      include: { requesterBrand: true, targetCommunity: { include: { hostProfile: true } } },
    })
    if (!interest) throw new NotFoundException('Collaboration chat not found')
    const isBrand = !!brand && interest.requesterBrandId === brand.id
    const isCommunity = !!community && interest.targetCommunityId === community.id
    if (!isBrand && !isCommunity) throw new UnauthorizedException('You are not part of this chat')
    return { interest, isBrand }
  }

  private async formatThread(interest: any, isBrand: boolean) {
    const counterpartName = isBrand ? interest.targetCommunity.name : interest.requesterBrand.brandName
    const logoKey = isBrand ? interest.targetCommunity.logoKey : interest.requesterBrand.logoKey
    const messages = interest.chatMessages || []
    const last = messages[0]
    return {
      id: interest.id,
      collaborationType: 'BRAND_COMMUNITY',
      requesterBrandId: interest.requesterBrandId,
      targetCommunityId: interest.targetCommunityId,
      mySenderType: isBrand ? 'REQUESTER' : 'TARGET',
      direction: isBrand ? 'OUTGOING' : 'INCOMING',
      counterpartName,
      counterpartAvatarUrl: logoKey ? await this.storage.getPresignedDownloadUrl(logoKey) : null,
      chatStatus: interest.chatStatus,
      lastMessagePreview: last ? last.content || (last.mediaKey ? '📎 Attachment' : '') : null,
      lastMessageAt: interest.lastMessageAt,
      createdAt: interest.createdAt,
      unreadCount: 0,
    }
  }

  async getChats(userId: string, status?: CommunityCollaborationStatus) {
    const { brand, community } = await this.getIdentity(userId)
    if (!brand && !community) throw new UnauthorizedException('Brand or Community profile required')
    const where: any = { ...(status ? { chatStatus: status } : {}) }
    where[brand ? 'requesterBrandId' : 'targetCommunityId'] = brand ? brand.id : community.id
    const interests = await this.prisma.brandCommunityCollaborationInterest.findMany({
      where,
      include: { requesterBrand: true, targetCommunity: true, chatMessages: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
    })
    return Promise.all(interests.map((interest) => this.formatThread(interest, !!brand)))
  }

  async getMessages(interestId: string, userId: string) {
    const { interest, isBrand } = await this.findForUser(interestId, userId)
    const messages = await this.prisma.brandCommunityCollaborationMessage.findMany({
      where: { collaborationId: interestId },
      orderBy: { createdAt: 'asc' },
      include: { sender: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
    })
    await this.prisma.brandCommunityCollaborationInterest.update({ where: { id: interestId }, data: isBrand ? { requesterLastReadAt: new Date() } : { targetLastReadAt: new Date() } })
    return {
      messages: await Promise.all(messages.map(async (message) => ({ ...message, mediaUrl: message.mediaKey ? await this.storage.getPresignedDownloadUrl(message.mediaKey) : null }))),
      chatStatus: interest.chatStatus,
      mySenderType: isBrand ? 'REQUESTER' : 'TARGET',
      counterpartName: isBrand ? interest.targetCommunity.name : interest.requesterBrand.brandName,
      counterpartAvatarUrl: isBrand ? null : interest.requesterBrand.logoKey ? await this.storage.getPresignedDownloadUrl(interest.requesterBrand.logoKey) : null,
    }
  }

  async accept(interestId: string, userId: string) {
    const { interest, isBrand } = await this.findForUser(interestId, userId)
    if (isBrand) throw new BadRequestException('Only the community can accept this request')
    const updated = await this.prisma.brandCommunityCollaborationInterest.update({ where: { id: interest.id }, data: { chatStatus: 'ACCEPTED', chatAcceptedAt: new Date() } })
    return { message: 'Collaboration request accepted', chatStatus: updated.chatStatus }
  }

  async decline(interestId: string, userId: string) {
    const { interest, isBrand } = await this.findForUser(interestId, userId)
    if (isBrand) throw new BadRequestException('Only the community can decline this request')
    const updated = await this.prisma.brandCommunityCollaborationInterest.update({ where: { id: interest.id }, data: { chatStatus: 'DECLINED' } })
    return { message: 'Collaboration request declined', chatStatus: updated.chatStatus }
  }

  async sendMessage(interestId: string, userId: string, dto: CreateCollaborationMessageDto) {
    if (!dto.content?.trim() && !dto.mediaKey) throw new BadRequestException('Message must have text or an image')
    const { interest, isBrand } = await this.findForUser(interestId, userId)
    if (interest.chatStatus !== 'ACCEPTED') throw new BadRequestException('Accept the request before sending messages')
    const message = await this.prisma.brandCommunityCollaborationMessage.create({
      data: { collaborationId: interest.id, senderType: isBrand ? 'REQUESTER' : 'TARGET', senderId: userId, content: dto.content?.trim() ?? '', mediaKey: dto.mediaKey },
      include: { sender: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
    })
    await this.prisma.brandCommunityCollaborationInterest.update({ where: { id: interest.id }, data: { lastMessageAt: message.createdAt } })
    return { ...message, mediaUrl: message.mediaKey ? await this.storage.getPresignedDownloadUrl(message.mediaKey) : null }
  }
}
