import { BadRequestException, Injectable, NotFoundException, UnauthorizedException, ForbiddenException } from '@nestjs/common'
import { CommunityCollaborationStatus } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { StorageService } from '../../common/storage/storage.service'
import { CreateCollaborationMessageDto } from '../community-collaboration/dto/create-collaboration-message.dto'
import { MarkBrandCommunityInterestDto } from './dto/mark-brand-community-interest.dto'
import { NotificationsService } from '../notifications/notifications.service'
import { redactPersonalInfo } from '../../common/utils/redact-personal-info.util'

@Injectable()
export class BrandCommunityCollaborationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

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

  async markInterest(targetCommunityId: string, brandUserId: string, dto?: MarkBrandCommunityInterestDto) {
    const { brand } = await this.getIdentity(brandUserId)
    if (!brand) throw new UnauthorizedException('Brand profile required')
    const target = await this.prisma.hostCommunityProfile.findFirst({
      where: { OR: [{ id: targetCommunityId }, { hostProfileId: targetCommunityId }], approvalStatus: 'APPROVED', isHidden: false },
    })
    if (!target) throw new NotFoundException('Community not found')
    const existing = await this.prisma.brandCommunityCollaborationInterest.findUnique({
      where: { requesterBrandId_targetCommunityId: { requesterBrandId: brand.id, targetCommunityId: target.id } },
    })
    const domain = dto?.domain || 'SPONSORSHIP'

    if (existing) {
      if (dto?.domain && existing.interestDomain !== dto.domain) {
        await this.prisma.brandCommunityCollaborationInterest.update({
          where: { id: existing.id },
          data: { interestDomain: dto.domain },
        })
      }
      return {
        message: 'Collaboration request already exists',
        alreadyInterested: true,
        interestId: existing.id,
        chatStatus: existing.chatStatus,
        interestDomain: dto?.domain || existing.interestDomain || 'SPONSORSHIP',
      }
    }

    const interest = await this.prisma.brandCommunityCollaborationInterest.create({
      data: {
        requesterBrandId: brand.id,
        targetCommunityId: target.id,
        interestDomain: domain,
      },
    })

    const communityRecipientUserIds = await this.getCommunityMemberUserIds(target.id)
    const uniqueRecipientUserIds = [...new Set(communityRecipientUserIds.filter((recipientUserId) => recipientUserId !== brandUserId))]

    const domainLabels: Record<string, string> = {
      SPONSORSHIP: 'Sponsorship',
      BRANDED_CONTENT: 'Branded Content',
      SAMPLING: 'Sampling',
    }
    const domainLabel = domainLabels[domain] || 'Collaboration'

    await Promise.all(uniqueRecipientUserIds.map((recipientUserId) => this.notifications.create(
      recipientUserId,
      'brand_community_chat_message',
      `${brand.brandName} is interested in ${domainLabel}`,
      `Tap to view the ${domainLabel.toLowerCase()} request from ${brand.brandName}`,
      { brandCommunityInterestId: interest.id, interestId: interest.id, collaborationType: 'BRAND_COMMUNITY' },
    )))

    return {
      message: 'Collaboration request sent',
      alreadyInterested: false,
      interestId: interest.id,
      chatStatus: interest.chatStatus,
      interestDomain: domain,
    }
  }

  private async findForUser(interestId: string, userId: string, preferredRole?: 'BRAND' | 'COMMUNITY') {
    const { brand, community } = await this.getIdentity(userId)
    const interest = await this.prisma.brandCommunityCollaborationInterest.findUnique({
      where: { id: interestId },
      include: { requesterBrand: true, targetCommunity: { include: { hostProfile: true } } },
    })
    if (!interest) throw new NotFoundException('Collaboration chat not found')
    const isBrand = preferredRole === 'COMMUNITY'
      ? false
      : preferredRole === 'BRAND'
        ? !!brand && interest.requesterBrandId === brand.id
        : !!brand && interest.requesterBrandId === brand.id
    const isCommunity = !!community && interest.targetCommunityId === community.id
    if (!isBrand && !isCommunity) throw new UnauthorizedException('You are not part of this chat')
    return { interest, isBrand }
  }

  private async formatThread(interest: any, isBrand: boolean) {
    const counterpartName = isBrand ? interest.targetCommunity.name : interest.requesterBrand.brandName
    const logoKey = isBrand ? interest.targetCommunity.logoKey : interest.requesterBrand.logoKey
    const messages = interest.chatMessages || []
    const last = messages[0]
    const lastReadAt = isBrand ? interest.requesterLastReadAt : interest.targetLastReadAt
    const unreadCount = await this.prisma.brandCommunityCollaborationMessage.count({
      where: {
        collaborationId: interest.id,
        deletedAt: null,
        senderType: isBrand ? 'TARGET' : 'REQUESTER',
        ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
      },
    })
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
      interestDomain: interest.interestDomain || 'SPONSORSHIP',
      lastMessagePreview: last ? last.content || (last.mediaKey ? '📎 Attachment' : '') : null,
      lastMessageAt: interest.lastMessageAt,
      createdAt: interest.createdAt,
      unreadCount,
    }
  }

  private async getBrandMemberUserIds(brandProfileId: string): Promise<string[]> {
    const brand = await this.prisma.brandProfile.findUnique({
      where: { id: brandProfileId },
      select: { userId: true, teamMembers: { where: { status: 'ACTIVE', userId: { not: null } }, select: { userId: true } } },
    })

    return [
      brand?.userId,
      ...(brand?.teamMembers ?? []).map((member) => member.userId),
    ].filter((id): id is string => Boolean(id))
  }

  private async getCommunityMemberUserIds(communityProfileId: string): Promise<string[]> {
    const community = await this.prisma.hostCommunityProfile.findUnique({
      where: { id: communityProfileId },
      select: { hostProfileId: true },
    })

    const host = community?.hostProfileId
      ? await this.prisma.hostProfile.findUnique({
        where: { id: community.hostProfileId },
        select: { userId: true, teamMembers: { where: { status: 'ACTIVE', userId: { not: null } }, select: { userId: true } } },
      })
      : null

    return [
      host?.userId,
      ...(host?.teamMembers ?? []).map((member) => member.userId),
    ].filter((id): id is string => Boolean(id))
  }

  private async getParticipantUserIds(interest: any): Promise<string[]> {
    const [brandUserIds, hostUserIds] = await Promise.all([
      this.getBrandMemberUserIds(interest.requesterBrandId),
      this.getCommunityMemberUserIds(interest.targetCommunityId),
    ])

    return [...new Set([...brandUserIds, ...hostUserIds])]
  }

  async getChats(userId: string, status?: CommunityCollaborationStatus, preferredRole?: 'BRAND' | 'COMMUNITY') {
    const { brand, community } = await this.getIdentity(userId)
    if (!brand && !community) throw new UnauthorizedException('Brand or Community profile required')
    const where: any = { ...(status ? { chatStatus: status } : {}) }
    const actingAsBrand = preferredRole === 'BRAND' ? !!brand : preferredRole === 'COMMUNITY' ? false : !!brand
    where[actingAsBrand ? 'requesterBrandId' : 'targetCommunityId'] = actingAsBrand ? brand!.id : community!.id
    const interests = await this.prisma.brandCommunityCollaborationInterest.findMany({
      where,
      include: { requesterBrand: true, targetCommunity: true, chatMessages: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
    })
    return Promise.all(interests.map((interest) => this.formatThread(interest, actingAsBrand)))
  }

  async getMessages(interestId: string, userId: string, preferredRole?: 'BRAND' | 'COMMUNITY') {
    const { interest, isBrand } = await this.findForUser(interestId, userId, preferredRole)
    const messages = await this.prisma.brandCommunityCollaborationMessage.findMany({
      where: { collaborationId: interestId },
      orderBy: { createdAt: 'asc' },
      include: { sender: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
    })
    await this.prisma.brandCommunityCollaborationInterest.update({ where: { id: interestId }, data: isBrand ? { requesterLastReadAt: new Date() } : { targetLastReadAt: new Date() } })
    await this.notifications.markAllReadForThread(userId, interestId)
    return {
      messages: await Promise.all(messages.map(async (message) => ({ ...message, mediaUrl: message.mediaKey ? await this.storage.getPresignedDownloadUrl(message.mediaKey) : null }))),
      chatStatus: interest.chatStatus,
      mySenderType: isBrand ? 'REQUESTER' : 'TARGET',
      counterpartName: isBrand ? interest.targetCommunity.name : interest.requesterBrand.brandName,
      counterpartAvatarUrl: isBrand ? null : interest.requesterBrand.logoKey ? await this.storage.getPresignedDownloadUrl(interest.requesterBrand.logoKey) : null,
    }
  }

  async accept(interestId: string, userId: string, preferredRole?: 'BRAND' | 'COMMUNITY') {
    const { interest, isBrand } = await this.findForUser(interestId, userId, preferredRole)
    if (isBrand) throw new BadRequestException('Only the community can accept this request')
    const updated = await this.prisma.brandCommunityCollaborationInterest.update({ where: { id: interest.id }, data: { chatStatus: 'ACCEPTED', chatAcceptedAt: new Date() } })

    const brandRecipientUserIds = await this.getBrandMemberUserIds(interest.requesterBrandId)
    const uniqueRecipientUserIds = [...new Set(brandRecipientUserIds.filter((recipientUserId) => recipientUserId !== userId))]
    await Promise.all(uniqueRecipientUserIds.map((recipientUserId) => this.notifications.create(
      recipientUserId,
      'brand_community_chat_message',
      `${interest.targetCommunity.name} accepted your collaboration request`,
      `Your collaboration request with ${interest.targetCommunity.name} is now active.`,
      { brandCommunityInterestId: interest.id, interestId: interest.id, collaborationType: 'BRAND_COMMUNITY' },
    )))

    return { message: 'Collaboration request accepted', chatStatus: updated.chatStatus }
  }

  async decline(interestId: string, userId: string, preferredRole?: 'BRAND' | 'COMMUNITY') {
    const { interest, isBrand } = await this.findForUser(interestId, userId, preferredRole)
    if (isBrand) throw new BadRequestException('Only the community can decline this request')
    const updated = await this.prisma.brandCommunityCollaborationInterest.update({ where: { id: interest.id }, data: { chatStatus: 'DECLINED' } })

    const brandRecipientUserIds = await this.getBrandMemberUserIds(interest.requesterBrandId)
    const uniqueRecipientUserIds = [...new Set(brandRecipientUserIds.filter((recipientUserId) => recipientUserId !== userId))]
    await Promise.all(uniqueRecipientUserIds.map((recipientUserId) => this.notifications.create(
      recipientUserId,
      'brand_community_chat_message',
      `${interest.targetCommunity.name} declined your collaboration request`,
      `Your collaboration request with ${interest.targetCommunity.name} was not accepted.`,
      { brandCommunityInterestId: interest.id, interestId: interest.id, collaborationType: 'BRAND_COMMUNITY' },
    )))

    return { message: 'Collaboration request declined', chatStatus: updated.chatStatus }
  }

  async sendMessage(interestId: string, userId: string, dto: CreateCollaborationMessageDto, preferredRole?: 'BRAND' | 'COMMUNITY') {
    if (!dto.content?.trim() && !dto.mediaKey) throw new BadRequestException('Message must have text or an image')
    const { interest, isBrand } = await this.findForUser(interestId, userId, preferredRole)
    if (interest.chatStatus !== 'ACCEPTED') throw new BadRequestException('Accept the request before sending messages')
    const message = await this.prisma.brandCommunityCollaborationMessage.create({
      data: { collaborationId: interest.id, senderType: isBrand ? 'REQUESTER' : 'TARGET', senderId: userId, content: dto.content?.trim() ?? '', mediaKey: dto.mediaKey },
      include: { sender: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
    })
    await this.prisma.brandCommunityCollaborationInterest.update({ where: { id: interest.id }, data: { lastMessageAt: message.createdAt } })

    const participantUserIds = await this.getParticipantUserIds(interest)
    const recipientUserIds = participantUserIds.filter((participantId) => participantId !== userId)
    await Promise.all(recipientUserIds.map((recipientUserId) => this.notifications.create(
      recipientUserId,
      'brand_community_chat_message',
      isBrand ? `${interest.requesterBrand.brandName} sent a message` : `${interest.targetCommunity.name} sent a message`,
      message.content || 'Sent an attachment',
      { brandCommunityInterestId: interest.id, interestId: interest.id, collaborationType: 'BRAND_COMMUNITY' },
    )))
    return { ...message, mediaUrl: message.mediaKey ? await this.storage.getPresignedDownloadUrl(message.mediaKey) : null }
  }

  async editMessage(
    interestId: string,
    userId: string,
    messageId: string,
    dto: CreateCollaborationMessageDto,
    preferredRole?: 'BRAND' | 'COMMUNITY',
  ) {
    const { interest } = await this.findForUser(interestId, userId, preferredRole)
    const message = await this.prisma.brandCommunityCollaborationMessage.findUnique({
      where: { id: messageId },
    })

    if (!message || message.collaborationId !== interestId) {
      throw new NotFoundException('Message not found')
    }

    if (message.senderId !== userId) {
      throw new ForbiddenException('You can only edit your own messages')
    }

    if (message.deletedAt) {
      throw new BadRequestException('Cannot edit a deleted message')
    }

    const { content, wasRedacted } = redactPersonalInfo(dto.content)
    const updated = await this.prisma.brandCommunityCollaborationMessage.update({
      where: { id: messageId },
      data: { content, editedAt: new Date() },
      include: { sender: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
    })

    const mediaUrl = message.mediaKey ? await this.storage.getPresignedDownloadUrl(message.mediaKey) : null
    return { ...updated, mediaUrl, wasRedacted }
  }

  async deleteMessage(
    interestId: string,
    userId: string,
    messageId: string,
    preferredRole?: 'BRAND' | 'COMMUNITY',
  ) {
    const { interest } = await this.findForUser(interestId, userId, preferredRole)
    const message = await this.prisma.brandCommunityCollaborationMessage.findUnique({
      where: { id: messageId },
    })

    if (!message || message.collaborationId !== interestId) {
      throw new NotFoundException('Message not found')
    }

    if (message.senderId !== userId) {
      throw new ForbiddenException('You can only delete your own messages')
    }

    if (message.deletedAt) {
      return { message: 'Already deleted', deleted: true }
    }

    await this.prisma.brandCommunityCollaborationMessage.update({
      where: { id: messageId },
      data: { deletedAt: new Date() },
    })

    return { message: 'Message deleted', deleted: true }
  }

  // ─── Deal & Report Flow ──────────────────────────────────────────────────

  async getDeal(interestId: string, userId: string, preferredRole?: 'BRAND' | 'COMMUNITY') {
    await this.findForUser(interestId, userId, preferredRole)
    return this.prisma.brandCommunityCollaborationDeal.findUnique({
      where: { collaborationInterestId: interestId },
      include: { report: true },
    })
  }

  async lockDeal(
    interestId: string,
    userId: string,
    dto: any,
    preferredRole?: 'BRAND' | 'COMMUNITY',
  ) {
    const { interest, isBrand } = await this.findForUser(interestId, userId, preferredRole)
    if (isBrand) {
      throw new ForbiddenException('Only the community can lock a deal')
    }
    if (interest.chatStatus !== 'ACCEPTED') {
      throw new BadRequestException('The chat must be accepted before locking a deal')
    }

    const domain = (dto.collaborationType || interest.interestDomain || 'SPONSORSHIP').toUpperCase()
    const domainLabels: Record<string, string> = {
      SPONSORSHIP: 'Sponsorship',
      BRANDED_CONTENT: 'Branded Content',
      SAMPLING: 'Sampling',
    }
    const domainLabel = domainLabels[domain] || domain

    const existing = await this.prisma.brandCommunityCollaborationDeal.findUnique({
      where: { collaborationInterestId: interestId },
    })

    let deal
    if (existing) {
      if (existing.status === 'APPROVED') {
        throw new BadRequestException('This deal is already approved and locked')
      }
      deal = await this.prisma.brandCommunityCollaborationDeal.update({
        where: { id: existing.id },
        data: {
          collaborationType: domain,
          projectName: dto.projectName,
          startDate: new Date(dto.startDate),
          endDate: dto.endDate ? new Date(dto.endDate) : null,
          time: dto.time,
          sponsorshipCategory: dto.sponsorshipCategory,
          sponsorshipAmount: dto.sponsorshipAmount ?? 0,
          venue: dto.venue,
          barterElements: dto.barterElements,
          deliverables: dto.deliverables,
          otherTerms: dto.otherTerms,
          additionalNotes: dto.additionalNotes,
          dealData: dto.dealData ?? existing.dealData,
          status: 'PENDING_APPROVAL',
          version: existing.version + 1,
          changeRequestNote: null,
        },
        include: { report: true },
      })
    } else {
      deal = await this.prisma.brandCommunityCollaborationDeal.create({
        data: {
          collaborationInterestId: interest.id,
          collaborationType: domain,
          projectName: dto.projectName,
          startDate: new Date(dto.startDate),
          endDate: dto.endDate ? new Date(dto.endDate) : null,
          time: dto.time,
          sponsorshipCategory: dto.sponsorshipCategory,
          sponsorshipAmount: dto.sponsorshipAmount ?? 0,
          venue: dto.venue,
          barterElements: dto.barterElements,
          deliverables: dto.deliverables,
          otherTerms: dto.otherTerms,
          additionalNotes: dto.additionalNotes,
          dealData: dto.dealData,
          createdById: userId,
          status: 'PENDING_APPROVAL',
        },
        include: { report: true },
      })
    }

    // Keep interest domain in sync
    await this.prisma.brandCommunityCollaborationInterest.update({
      where: { id: interest.id },
      data: { interestDomain: domain },
    })

    // Post system message into chat
    const actionText = existing ? 'updated the deal terms' : 'locked the deal terms'
    await this.prisma.brandCommunityCollaborationMessage.create({
      data: {
        collaborationId: interest.id,
        senderType: 'TARGET',
        senderId: userId,
        messageType: 'SYSTEM' as any,
        content: `[System] Community ${actionText} for ${domainLabel} Collaboration.`,
      },
    })

    const brandUserIds = await this.getBrandMemberUserIds(interest.requesterBrandId)
    await Promise.all(
      brandUserIds.map((uid) =>
        this.notifications.create(
          uid,
          'brand_community_chat_message',
          `Deal proposal: ${dto.projectName}`,
          `The community shared a ${domainLabel.toLowerCase()} deal for your approval.`,
          { brandCommunityInterestId: interest.id, interestId: interest.id, collaborationType: 'BRAND_COMMUNITY' },
        ),
      ),
    )

    return deal
  }

  async approveDeal(interestId: string, userId: string, preferredRole?: 'BRAND' | 'COMMUNITY') {
    const { interest, isBrand } = await this.findForUser(interestId, userId, preferredRole)
    if (!isBrand) {
      throw new ForbiddenException('Only the brand can approve the deal')
    }

    const deal = await this.prisma.brandCommunityCollaborationDeal.findUnique({
      where: { collaborationInterestId: interestId },
    })
    if (!deal) throw new NotFoundException('No deal found for this chat')
    if (deal.status === 'APPROVED') return deal

    const updated = await this.prisma.brandCommunityCollaborationDeal.update({
      where: { id: deal.id },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
        changeRequestNote: null,
      },
      include: { report: true },
    })

    await this.prisma.brandCommunityCollaborationMessage.create({
      data: {
        collaborationId: interest.id,
        senderType: 'REQUESTER',
        senderId: userId,
        messageType: 'SYSTEM' as any,
        content: 'Congratulations! The deal is locked.',
      },
    })

    const hostUserIds = await this.getCommunityMemberUserIds(interest.targetCommunityId)
    await Promise.all(
      hostUserIds.map((uid) =>
        this.notifications.create(
          uid,
          'brand_community_chat_message',
          `Deal Approved: ${deal.projectName}`,
          'The brand has approved and locked the deal terms.',
          { brandCommunityInterestId: interest.id, interestId: interest.id, collaborationType: 'BRAND_COMMUNITY' },
        ),
      ),
    )

    return updated
  }

  async requestDealChanges(
    interestId: string,
    userId: string,
    note?: string,
    preferredRole?: 'BRAND' | 'COMMUNITY',
  ) {
    const { interest, isBrand } = await this.findForUser(interestId, userId, preferredRole)
    if (!isBrand) {
      throw new ForbiddenException('Only the brand can request changes to the deal')
    }

    const deal = await this.prisma.brandCommunityCollaborationDeal.findUnique({
      where: { collaborationInterestId: interestId },
    })
    if (!deal) throw new NotFoundException('No deal found for this chat')
    if (deal.status === 'APPROVED') {
      throw new BadRequestException('This deal is already approved')
    }

    const updated = await this.prisma.brandCommunityCollaborationDeal.update({
      where: { id: deal.id },
      data: {
        status: 'CHANGES_REQUESTED',
        changeRequestNote: note?.trim() || null,
      },
      include: { report: true },
    })

    const noteSuffix = note?.trim() ? `: "${note.trim()}"` : ''
    await this.prisma.brandCommunityCollaborationMessage.create({
      data: {
        collaborationId: interest.id,
        senderType: 'REQUESTER',
        senderId: userId,
        messageType: 'SYSTEM' as any,
        content: `⚠️ Changes were requested on the deal${noteSuffix}`,
      },
    })

    const hostUserIds = await this.getCommunityMemberUserIds(interest.targetCommunityId)
    await Promise.all(
      hostUserIds.map((uid) =>
        this.notifications.create(
          uid,
          'brand_community_chat_message',
          `Changes Requested: ${deal.projectName}`,
          note?.trim() ? `Note: ${note.trim()}` : 'The brand requested changes to the deal.',
          { brandCommunityInterestId: interest.id, interestId: interest.id, collaborationType: 'BRAND_COMMUNITY' },
        ),
      ),
    )

    return updated
  }

  async submitDealReport(
    interestId: string,
    userId: string,
    dto: any,
    preferredRole?: 'BRAND' | 'COMMUNITY',
  ) {
    const { interest, isBrand } = await this.findForUser(interestId, userId, preferredRole)
    if (isBrand) {
      throw new ForbiddenException('Only the community can submit the deliverables report')
    }

    const deal = await this.prisma.brandCommunityCollaborationDeal.findUnique({
      where: { collaborationInterestId: interestId },
      include: { report: true },
    })
    if (!deal) throw new NotFoundException('No deal found')
    if (deal.status !== 'APPROVED') {
      throw new BadRequestException('The deal must be approved before submitting a report')
    }

    let report
    if (deal.report) {
      report = await this.prisma.brandCommunityCollaborationDealReport.update({
        where: { id: deal.report.id },
        data: {
          projectName: dto.projectName || deal.projectName,
          eventDate: dto.eventDate || deal.startDate.toISOString().slice(0, 10),
          venue: dto.venue || deal.venue,
          time: dto.time || deal.time,
          guestCount: dto.guestCount,
          ageRange: dto.ageRange,
          deliverables: dto.deliverables ?? deal.report.deliverables,
          videoLinks: dto.videoLinks ?? deal.report.videoLinks,
          socialLinks: dto.socialLinks ?? deal.report.socialLinks,
          mediaKeys: dto.mediaKeys ?? deal.report.mediaKeys,
          summary: dto.summary ?? deal.report.summary,
          reportData: dto.reportData ?? deal.report.reportData,
          status: 'APPROVED',
        },
      })
    } else {
      report = await this.prisma.brandCommunityCollaborationDealReport.create({
        data: {
          dealId: deal.id,
          projectName: dto.projectName || deal.projectName,
          eventDate: dto.eventDate || deal.startDate.toISOString().slice(0, 10),
          venue: dto.venue || deal.venue,
          time: dto.time || deal.time,
          guestCount: dto.guestCount,
          ageRange: dto.ageRange,
          deliverables: dto.deliverables ?? [],
          videoLinks: dto.videoLinks ?? [],
          socialLinks: dto.socialLinks ?? [],
          mediaKeys: dto.mediaKeys ?? [],
          summary: dto.summary,
          reportData: dto.reportData,
          status: 'APPROVED',
        },
      })
    }

    await this.prisma.brandCommunityCollaborationMessage.create({
      data: {
        collaborationId: interest.id,
        senderType: 'TARGET',
        senderId: userId,
        messageType: 'SYSTEM' as any,
        content: `[System] Deliverables report was submitted by the community.`,
      },
    })

    const brandUserIds = await this.getBrandMemberUserIds(interest.requesterBrandId)
    await Promise.all(
      brandUserIds.map((uid) =>
        this.notifications.create(
          uid,
          'brand_community_chat_message',
          `Report Submitted: ${deal.projectName}`,
          'The community has submitted the deliverables report.',
          { brandCommunityInterestId: interest.id, interestId: interest.id, collaborationType: 'BRAND_COMMUNITY' },
        ),
      ),
    )

    return report
  }
}
