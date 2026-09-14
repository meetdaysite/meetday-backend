import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SpaceHostChatSenderType, ChatMessageType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TeamAccessService } from '../../common/team-access/team-access.service';
import { redactPersonalInfo } from '../../common/utils/redact-personal-info.util';
import { CreateSpaceHostInterestDto } from './dto/create-space-host-interest.dto';
import { ListSpaceHostChatsQueryDto } from './dto/list-space-host-chats-query.dto';
import { SendSpaceHostChatMessageDto } from './dto/send-space-host-chat-message.dto';
import { UpsertSpaceHostDealDto } from './dto/upsert-space-host-deal.dto';
import { RequestSpaceHostDealChangesDto } from './dto/request-space-host-deal-changes.dto';
import { UpsertSpaceHostDealReportDto } from './dto/upsert-space-host-deal-report.dto';

// A Space Partner expressing interest in partnering with a Community — the reverse direction of
// SpaceInterest. The Space is always the requester and always locks the deal/submits the report;
// the Host/Community is always the target and always approves — mirrors SpacesService's TriChat
// shape almost exactly, just simpler (only one requester type, so no requesterType branching).
@Injectable()
export class SpaceHostInterestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly notificationsService: NotificationsService,
    private readonly teamAccessService: TeamAccessService,
  ) {}

  private async getOwnProfiles(userId: string) {
    const [hostProfileIds, spaceProfile] = await Promise.all([
      this.teamAccessService.getHostProfileIds(userId),
      this.prisma.spaceProfile.findUnique({ where: { userId }, select: { id: true } }),
    ]);
    return { hostProfileId: hostProfileIds[0] ?? null, spaceProfileId: spaceProfile?.id ?? null };
  }

  // Space partner expresses interest in a Community — idempotent, notifies the community (who
  // decides whether to accept) and confirms back to the space.
  async markInterest(userId: string, hostProfileId: string, dto: CreateSpaceHostInterestDto) {
    const host = await this.prisma.hostProfile.findUnique({
      where: { id: hostProfileId },
      select: {
        id: true,
        userId: true,
        displayName: true,
        communityProfile: { select: { name: true, approvalStatus: true, isHidden: true } },
      },
    });
    if (!host || !host.communityProfile || host.communityProfile.approvalStatus !== 'APPROVED' || host.communityProfile.isHidden) {
      throw new NotFoundException('Community not found');
    }

    const { spaceProfileId } = await this.getOwnProfiles(userId);
    if (!spaceProfileId) throw new BadRequestException('Only a Space Partner account can express interest in a Community');

    const existing = await this.prisma.spaceHostInterest.findUnique({
      where: { hostProfileId_spaceProfileId: { hostProfileId, spaceProfileId } },
    });
    if (existing) {
      return { message: 'Already interested', alreadyInterested: true, interestId: existing.id, chatStatus: existing.chatStatus };
    }

    const interest = await this.prisma.spaceHostInterest.create({
      data: { hostProfileId, spaceProfileId, message: dto.message?.trim() || null },
    });

    const communityName = host.communityProfile.name ?? host.displayName ?? 'Community';
    if (host.userId !== userId) {
      void this.notificationsService
        .create(
          host.userId,
          'space_host_interest_requested',
          'New partnership interest',
          'A Community Space is interested in partnering with you — check your Requests to respond.',
          { spaceHostInterestId: interest.id, hostProfileId },
        )
        .catch(() => undefined);
    }

    void this.notificationsService
      .create(userId, 'space_host_interest_confirmed', 'Interest sent!', `${communityName} has been notified of your interest.`, {
        spaceHostInterestId: interest.id,
      })
      .catch(() => undefined);

    return { message: 'Interest recorded', alreadyInterested: false, interestId: interest.id, chatStatus: interest.chatStatus };
  }

  async listMyChats(userId: string, query: ListSpaceHostChatsQueryDto) {
    const { hostProfileId, spaceProfileId } = await this.getOwnProfiles(userId);
    const role = query.role ?? (spaceProfileId ? 'SPACE' : hostProfileId ? 'HOST' : null);
    if (!role) throw new NotFoundException('No host or space profile found for this account');
    if (role === 'SPACE' && !spaceProfileId) throw new NotFoundException("You don't have a Space Partner profile on this account");
    if (role === 'HOST' && !hostProfileId) throw new NotFoundException("You don't have a Community profile on this account");

    const where: Prisma.SpaceHostInterestWhereInput = {
      ...(query.status && { chatStatus: query.status }),
      ...(role === 'SPACE' ? { spaceProfileId: spaceProfileId! } : { hostProfileId: hostProfileId! }),
    };

    const interests = await this.prisma.spaceHostInterest.findMany({
      where,
      include: {
        hostProfile: { select: { id: true, displayName: true, communityProfile: { select: { name: true, logoKey: true } } } },
        spaceProfile: { select: { id: true, businessName: true, communityProfile: { select: { name: true, logoKey: true } } } },
        chatMessages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true, mediaKey: true, senderType: true, createdAt: true },
        },
        deal: { select: { id: true, status: true, report: { select: { id: true, status: true } } } },
      },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
    });

    const mySenderType: SpaceHostChatSenderType = role === 'SPACE' ? 'SPACE' : 'HOST';

    const threads = await Promise.all(
      interests.map(async (i) => {
        const lastReadAt = role === 'SPACE' ? i.requesterLastReadAt : i.communityLastReadAt;
        const unreadCount = await this.prisma.spaceHostChatMessage.count({
          where: {
            spaceHostInterestId: i.id,
            senderType: { not: mySenderType },
            deletedAt: null,
            ...(lastReadAt && { createdAt: { gt: lastReadAt } }),
          },
        });

        const counterpartName =
          role === 'SPACE'
            ? (i.hostProfile.communityProfile?.name ?? i.hostProfile.displayName ?? 'Community')
            : (i.spaceProfile.communityProfile?.name ?? i.spaceProfile.businessName ?? 'Space Partner');
        const counterpartLogoKey =
          role === 'SPACE' ? (i.hostProfile.communityProfile?.logoKey ?? null) : (i.spaceProfile.communityProfile?.logoKey ?? null);

        const lastMsg = i.chatMessages[0];
        return {
          id: i.id,
          hostProfileId: i.hostProfileId,
          spaceProfileId: i.spaceProfileId,
          chatStatus: i.chatStatus,
          createdAt: i.createdAt,
          chatAcceptedAt: i.chatAcceptedAt,
          lastMessageAt: i.lastMessageAt,
          lastMessagePreview: lastMsg ? (lastMsg.content || (lastMsg.mediaKey ? '📷 Photo' : '')).slice(0, 120) : (i.message ?? null),
          unreadCount,
          counterpartName,
          counterpartAvatarUrl: counterpartLogoKey ? await this.storageService.getPresignedDownloadUrl(counterpartLogoKey) : null,
          isDealLocked: i.deal?.status === 'APPROVED',
          isDealClosed: i.deal?.status === 'APPROVED' && i.deal?.report?.status === 'APPROVED',
        };
      }),
    );

    return threads;
  }

  private async getInterestForParticipant(userId: string, interestId: string, preferredRole?: 'HOST' | 'SPACE') {
    const interest = await this.prisma.spaceHostInterest.findUnique({
      where: { id: interestId },
      include: {
        hostProfile: { select: { id: true, userId: true, displayName: true, communityProfile: { select: { name: true } } } },
        spaceProfile: { select: { id: true, userId: true, businessName: true, communityProfile: { select: { name: true } } } },
      },
    });
    if (!interest) throw new NotFoundException('Chat thread not found');

    let isHost = interest.hostProfile.userId === userId;
    let isSpace = interest.spaceProfile.userId === userId;
    if (!isHost && !isSpace) {
      const hostProfileIds = await this.teamAccessService.getHostProfileIds(userId);
      isHost = hostProfileIds.includes(interest.hostProfileId);
    }
    if (!isHost && !isSpace) throw new ForbiddenException('You do not have access to this chat');

    let effectiveRole: SpaceHostChatSenderType;
    if (preferredRole === 'SPACE' && isSpace) effectiveRole = SpaceHostChatSenderType.SPACE;
    else if (preferredRole === 'HOST' && isHost) effectiveRole = SpaceHostChatSenderType.HOST;
    else if (isSpace) effectiveRole = SpaceHostChatSenderType.SPACE;
    else effectiveRole = SpaceHostChatSenderType.HOST;

    return { interest, isHost, isSpace, senderType: effectiveRole, effectiveRole };
  }

  async listChatMessages(userId: string, interestId: string, preferredRole?: 'HOST' | 'SPACE') {
    const { interest, senderType } = await this.getInterestForParticipant(userId, interestId, preferredRole);

    const messages = await this.prisma.spaceHostChatMessage.findMany({
      where: { spaceHostInterestId: interest.id },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: {
        id: true,
        senderType: true,
        senderId: true,
        content: true,
        mediaKey: true,
        messageType: true,
        deletedAt: true,
        createdAt: true,
        replyTo: { select: { id: true, senderType: true, content: true, mediaKey: true, deletedAt: true } },
      },
    });

    const withMediaUrls = await Promise.all(
      messages.map(async ({ mediaKey, deletedAt, replyTo, ...m }) => {
        if (deletedAt) return { ...m, content: '', mediaUrl: null, deletedAt, replyTo: this.replyToPreview(replyTo) };
        return {
          ...m,
          deletedAt: null,
          mediaUrl: mediaKey ? await this.storageService.getPresignedDownloadUrl(mediaKey) : null,
          replyTo: this.replyToPreview(replyTo),
        };
      }),
    );

    void this.prisma.spaceHostInterest
      .update({
        where: { id: interest.id },
        data: senderType === SpaceHostChatSenderType.SPACE ? { requesterLastReadAt: new Date() } : { communityLastReadAt: new Date() },
      })
      .catch(() => undefined);

    return { messages: withMediaUrls, chatStatus: interest.chatStatus };
  }

  private replyToPreview(
    replyTo: { id: string; senderType: SpaceHostChatSenderType; content: string; mediaKey: string | null; deletedAt: Date | null } | null,
  ) {
    if (!replyTo) return null;
    if (replyTo.deletedAt) {
      return { id: replyTo.id, senderType: replyTo.senderType, content: 'This message was deleted', hasMedia: false };
    }
    return { id: replyTo.id, senderType: replyTo.senderType, content: replyTo.content, hasMedia: !!replyTo.mediaKey };
  }

  async sendChatMessage(userId: string, interestId: string, dto: SendSpaceHostChatMessageDto) {
    const { interest, senderType } = await this.getInterestForParticipant(userId, interestId, dto.asRole);
    if (interest.chatStatus !== 'ACCEPTED') {
      throw new BadRequestException('The community must accept this request before you can chat.');
    }
    if (!dto.content?.trim() && !dto.mediaKey) {
      throw new BadRequestException('Message must have text or an image');
    }

    let replyToRow: { id: string; senderType: SpaceHostChatSenderType; content: string; mediaKey: string | null; deletedAt: Date | null } | null =
      null;
    if (dto.replyToId) {
      const original = await this.prisma.spaceHostChatMessage.findUnique({
        where: { id: dto.replyToId },
        select: { id: true, senderType: true, content: true, mediaKey: true, deletedAt: true, spaceHostInterestId: true },
      });
      if (!original || original.spaceHostInterestId !== interest.id) {
        throw new BadRequestException('You can only reply to a message in this chat');
      }
      replyToRow = original;
    }

    const { content, wasRedacted } = dto.content ? redactPersonalInfo(dto.content) : { content: '', wasRedacted: false };

    const message = await this.prisma.spaceHostChatMessage.create({
      data: { spaceHostInterestId: interest.id, senderType, senderId: userId, content, mediaKey: dto.mediaKey, replyToId: dto.replyToId },
    });
    await this.prisma.spaceHostInterest.update({
      where: { id: interest.id },
      data: {
        lastMessageAt: message.createdAt,
        ...(senderType === SpaceHostChatSenderType.SPACE ? { requesterLastReadAt: message.createdAt } : { communityLastReadAt: message.createdAt }),
      },
    });

    const recipientUserId = senderType === SpaceHostChatSenderType.SPACE ? interest.hostProfile.userId : interest.spaceProfile.userId;
    const senderName =
      senderType === SpaceHostChatSenderType.SPACE
        ? (interest.spaceProfile.communityProfile?.name ?? interest.spaceProfile.businessName ?? 'A space partner')
        : (interest.hostProfile.communityProfile?.name ?? interest.hostProfile.displayName ?? 'A community');

    const preview = content.trim() ? content.slice(0, 80) : '📷 Sent a photo';
    if (recipientUserId && recipientUserId !== userId) {
      void this.notificationsService
        .create(recipientUserId, 'space_host_chat_message', senderName, preview, { spaceHostInterestId: interest.id })
        .catch(() => undefined);
    }

    const mediaUrl = dto.mediaKey ? await this.storageService.getPresignedDownloadUrl(dto.mediaKey) : null;
    return { ...message, mediaUrl, wasRedacted, replyTo: this.replyToPreview(replyToRow) };
  }

  // Community accepts a pending request — opens the chat both sides ("Requests" → "Chats").
  async acceptInterest(userId: string, interestId: string, preferredRole?: 'HOST' | 'SPACE') {
    const { interest, effectiveRole } = await this.getInterestForParticipant(userId, interestId, preferredRole);
    if (effectiveRole !== 'HOST') throw new ForbiddenException('Only the community can accept this request');
    if (interest.chatStatus === 'ACCEPTED') return { message: 'Already accepted', chatStatus: interest.chatStatus };

    const updated = await this.prisma.spaceHostInterest.update({
      where: { id: interestId },
      data: { chatStatus: 'ACCEPTED', chatAcceptedAt: new Date() },
    });

    if (interest.spaceProfile.userId !== userId) {
      void this.notificationsService
        .create(
          interest.spaceProfile.userId,
          'space_host_interest_accepted',
          'Request accepted!',
          `${interest.hostProfile.communityProfile?.name ?? interest.hostProfile.displayName ?? 'The community'} accepted your interest — you can now chat with them.`,
          { spaceHostInterestId: interestId },
        )
        .catch(() => undefined);
    }

    return { message: 'Request accepted', chatStatus: updated.chatStatus };
  }

  // Community declines a pending request — terminal state, no further chat.
  async declineInterest(userId: string, interestId: string, preferredRole?: 'HOST' | 'SPACE') {
    const { interest, effectiveRole } = await this.getInterestForParticipant(userId, interestId, preferredRole);
    if (effectiveRole !== 'HOST') throw new ForbiddenException('Only the community can decline this request');
    if (interest.chatStatus !== 'REQUESTED') {
      throw new BadRequestException('Only a pending request can be declined');
    }

    const updated = await this.prisma.spaceHostInterest.update({ where: { id: interestId }, data: { chatStatus: 'DECLINED' } });
    return { message: 'Request declined', chatStatus: updated.chatStatus };
  }

  // ── Deal Lock: negotiated final terms, space fills in, community approves ───────────────

  async getDeal(userId: string, interestId: string) {
    const { interest } = await this.getInterestForParticipant(userId, interestId);
    return this.prisma.spaceHostDeal.findUnique({ where: { spaceHostInterestId: interest.id } });
  }

  private async postDealSystemMessage(interestId: string, senderType: SpaceHostChatSenderType, senderId: string, content: string) {
    const message = await this.prisma.spaceHostChatMessage.create({
      data: { spaceHostInterestId: interestId, senderType, senderId, content, messageType: ChatMessageType.SYSTEM },
    });
    await this.prisma.spaceHostInterest
      .update({
        where: { id: interestId },
        data: {
          lastMessageAt: message.createdAt,
          ...(senderType === SpaceHostChatSenderType.SPACE ? { requesterLastReadAt: message.createdAt } : { communityLastReadAt: message.createdAt }),
        },
      })
      .catch(() => undefined);
    return message;
  }

  async createDeal(userId: string, interestId: string, dto: UpsertSpaceHostDealDto) {
    const { interest, effectiveRole } = await this.getInterestForParticipant(userId, interestId, dto.asRole);
    if (effectiveRole !== 'SPACE') throw new ForbiddenException('Only the space can lock in deal terms');
    if (interest.chatStatus !== 'ACCEPTED') throw new BadRequestException('The chat must be accepted before locking a deal');

    const existing = await this.prisma.spaceHostDeal.findUnique({ where: { spaceHostInterestId: interest.id } });
    if (existing) throw new BadRequestException('A deal already exists for this chat — edit it instead');

    const deal = await this.prisma.spaceHostDeal.create({
      data: {
        spaceHostInterestId: interest.id,
        projectName: dto.projectName,
        goals: dto.goals ?? Prisma.JsonNull,
        venue: dto.venue,
        time: dto.time,
        targetAudience: dto.targetAudience ?? Prisma.JsonNull,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        sponsorshipAmount: dto.sponsorshipAmount,
        barterElements: dto.barterElements,
        deliverables: dto.deliverables,
        otherTerms: dto.otherTerms,
        additionalNotes: dto.additionalNotes,
        createdById: userId,
      },
    });

    if (interest.hostProfile.userId !== userId) {
      void this.notificationsService
        .create(
          interest.hostProfile.userId,
          'space_host_deal_locked',
          'Deal terms submitted',
          `${interest.spaceProfile.communityProfile?.name ?? interest.spaceProfile.businessName ?? 'The space partner'} submitted deal terms for your review.`,
          { spaceHostInterestId: interest.id },
        )
        .catch(() => undefined);
    }

    await this.postDealSystemMessage(interest.id, SpaceHostChatSenderType.SPACE, userId, 'Space Partner shared a deal proposal for your approval.');

    return deal;
  }

  async updateDeal(userId: string, interestId: string, dto: UpsertSpaceHostDealDto) {
    const { interest, effectiveRole } = await this.getInterestForParticipant(userId, interestId, dto.asRole);
    if (effectiveRole !== 'SPACE') throw new ForbiddenException('Only the space can edit deal terms');

    const existing = await this.prisma.spaceHostDeal.findUnique({ where: { spaceHostInterestId: interest.id } });
    if (!existing) throw new NotFoundException('No deal exists for this chat yet');
    if (existing.status === 'APPROVED') throw new BadRequestException('An approved deal cannot be edited');

    const updated = await this.prisma.spaceHostDeal.update({
      where: { spaceHostInterestId: interest.id },
      data: {
        projectName: dto.projectName,
        goals: dto.goals ?? Prisma.JsonNull,
        venue: dto.venue,
        time: dto.time,
        targetAudience: dto.targetAudience ?? Prisma.JsonNull,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        sponsorshipAmount: dto.sponsorshipAmount,
        barterElements: dto.barterElements,
        deliverables: dto.deliverables,
        otherTerms: dto.otherTerms,
        additionalNotes: dto.additionalNotes,
        status: 'PENDING_APPROVAL',
        changeRequestNote: null,
      },
    });

    if (interest.hostProfile.userId !== userId) {
      void this.notificationsService
        .create(
          interest.hostProfile.userId,
          'space_host_deal_updated',
          'Deal terms updated',
          `${interest.spaceProfile.communityProfile?.name ?? interest.spaceProfile.businessName ?? 'The space partner'} updated the deal terms — please review again.`,
          { spaceHostInterestId: interest.id },
        )
        .catch(() => undefined);
    }

    await this.postDealSystemMessage(interest.id, SpaceHostChatSenderType.SPACE, userId, 'Space Partner updated the deal proposal.');

    return updated;
  }

  async approveDeal(userId: string, interestId: string, preferredRole?: 'HOST' | 'SPACE') {
    const { interest, effectiveRole } = await this.getInterestForParticipant(userId, interestId, preferredRole);
    if (effectiveRole === 'SPACE') throw new ForbiddenException('Only the community can approve the deal');

    const existing = await this.prisma.spaceHostDeal.findUnique({ where: { spaceHostInterestId: interest.id } });
    if (!existing) throw new NotFoundException('No deal exists for this chat yet');

    const updated = await this.prisma.spaceHostDeal.update({
      where: { spaceHostInterestId: interest.id },
      data: { status: 'APPROVED', approvedAt: new Date(), changeRequestNote: null },
    });

    if (interest.spaceProfile.userId !== userId) {
      void this.notificationsService
        .create(
          interest.spaceProfile.userId,
          'space_host_deal_approved',
          'Deal approved!',
          'The community approved the deal — it is now locked.',
          { spaceHostInterestId: interest.id },
        )
        .catch(() => undefined);
    }

    await this.postDealSystemMessage(interest.id, SpaceHostChatSenderType.HOST, userId, '🔒 The deal is officially locked and confirmed!');

    return updated;
  }

  async requestDealChanges(userId: string, interestId: string, dto: RequestSpaceHostDealChangesDto) {
    const { interest, effectiveRole } = await this.getInterestForParticipant(userId, interestId, dto.asRole);
    if (effectiveRole === 'SPACE') throw new ForbiddenException('Only the community can request changes to the deal');

    const existing = await this.prisma.spaceHostDeal.findUnique({ where: { spaceHostInterestId: interest.id } });
    if (!existing) throw new NotFoundException('No deal exists for this chat yet');

    const updated = await this.prisma.spaceHostDeal.update({
      where: { spaceHostInterestId: interest.id },
      data: { status: 'CHANGES_REQUESTED', changeRequestNote: dto.note ?? null },
    });

    if (interest.spaceProfile.userId !== userId) {
      void this.notificationsService
        .create(
          interest.spaceProfile.userId,
          'space_host_deal_changes_requested',
          'Changes requested on the deal',
          dto.note || 'The community requested changes to the deal terms.',
          { spaceHostInterestId: interest.id },
        )
        .catch(() => undefined);
    }

    const noteSuffix = dto.note?.trim() ? `: "${dto.note.trim()}"` : '.';
    await this.postDealSystemMessage(interest.id, SpaceHostChatSenderType.HOST, userId, `Community requested changes to the deal${noteSuffix}`);

    return updated;
  }

  // ── Submit Report: space reports on completed deliverables once the deal is locked ──────

  async getDealReport(userId: string, interestId: string, preferredRole?: 'HOST' | 'SPACE') {
    const { interest } = await this.getInterestForParticipant(userId, interestId, preferredRole);
    const deal = await this.prisma.spaceHostDeal.findUnique({ where: { spaceHostInterestId: interest.id } });
    if (!deal) throw new NotFoundException('No deal found for this chat');

    const report = await this.prisma.spaceHostDealReport.findUnique({ where: { spaceHostDealId: deal.id } });
    if (!report) return null;

    const proofUrls = await Promise.all(
      (report.proofKeys ?? []).filter(Boolean).map(async (key) => {
        try {
          return await this.storageService.getPresignedDownloadUrl(key);
        } catch {
          return '';
        }
      }),
    );
    return { ...report, proofUrls };
  }

  async upsertDealReport(userId: string, interestId: string, dto: UpsertSpaceHostDealReportDto) {
    const { interest, effectiveRole } = await this.getInterestForParticipant(userId, interestId, dto.asRole);

    const deal = await this.prisma.spaceHostDeal.findUnique({ where: { spaceHostInterestId: interest.id } });
    if (!deal) throw new NotFoundException('No deal found for this chat');
    if (deal.status !== 'APPROVED') {
      throw new BadRequestException('The deal must be locked and approved before submitting a report');
    }

    const existingReport = await this.prisma.spaceHostDealReport.findUnique({ where: { spaceHostDealId: deal.id } });
    const isSpace = effectiveRole === SpaceHostChatSenderType.SPACE;
    if (!isSpace && !existingReport) {
      throw new ForbiddenException('Only the space can submit the deliverables report');
    }

    let parsedSummaryStatus: string | undefined;
    if (dto.summary) {
      try {
        parsedSummaryStatus = JSON.parse(dto.summary)?.status;
      } catch {
        /* not JSON — fall back to dto.status */
      }
    }

    const explicitStatus = dto.status || parsedSummaryStatus;
    const isCommunityReviewAction = explicitStatus === 'APPROVED' || explicitStatus === 'REVISION_REQUESTED';

    const finalStatus = isCommunityReviewAction && !isSpace ? explicitStatus : (explicitStatus ?? 'PENDING');
    const finalRevisionNote = finalStatus === 'REVISION_REQUESTED' ? (dto.revisionNote ?? dto.notes ?? null) : null;

    const report = await this.prisma.spaceHostDealReport.upsert({
      where: { spaceHostDealId: deal.id },
      create: {
        spaceHostDealId: deal.id,
        projectName: dto.projectName ?? 'Project',
        eventDate: dto.eventDate ?? '',
        venue: dto.venue ?? '',
        time: dto.time,
        guestCount: dto.guestCount,
        ageRange: dto.ageRange,
        deliverables: dto.deliverables ?? [],
        videoLinks: dto.videoLinks ?? [],
        socialLinks: dto.socialLinks ?? [],
        status: finalStatus,
        revisionNote: finalRevisionNote,
        summary: dto.summary,
        proofKeys: dto.proofKeys ?? [],
        notes: dto.notes,
        submittedById: userId,
      },
      update: {
        projectName: dto.projectName ?? 'Project',
        eventDate: dto.eventDate ?? '',
        venue: dto.venue ?? '',
        time: dto.time,
        guestCount: dto.guestCount,
        ageRange: dto.ageRange,
        deliverables: dto.deliverables ?? [],
        videoLinks: dto.videoLinks ?? [],
        socialLinks: dto.socialLinks ?? [],
        status: finalStatus,
        revisionNote: finalRevisionNote,
        summary: dto.summary,
        proofKeys: dto.proofKeys ?? [],
        notes: dto.notes,
        submittedById: userId,
      },
    });

    const hostUserId = interest.hostProfile.userId;
    const spaceUserId = interest.spaceProfile.userId;
    const spaceName = interest.spaceProfile.communityProfile?.name ?? interest.spaceProfile.businessName ?? 'The space partner';
    const communityName = interest.hostProfile.communityProfile?.name ?? interest.hostProfile.displayName ?? 'The community';

    if (finalStatus === 'PENDING') {
      await this.postDealSystemMessage(
        interest.id,
        SpaceHostChatSenderType.SPACE,
        userId,
        existingReport
          ? '📋 The deliverables report was updated and resubmitted for review.'
          : '📋 The deliverables report was submitted for review.',
      );

      if (hostUserId && hostUserId !== userId) {
        void this.notificationsService
          .create(hostUserId, 'space_host_deal_report_submitted', spaceName, 'Submitted the deliverables report for your locked deal', {
            spaceHostInterestId: interest.id,
          })
          .catch(() => undefined);
      }
    } else {
      const communityStatus = finalStatus === 'APPROVED' ? 'approved' : 'requested changes to';
      await this.postDealSystemMessage(
        interest.id,
        SpaceHostChatSenderType.HOST,
        userId,
        finalStatus === 'APPROVED'
          ? '✅ Congratulations! The deal is officially completed and closed!'
          : `⚠️ Revision was requested on the deliverables report${finalRevisionNote?.trim() ? `: "${finalRevisionNote.trim()}"` : '.'}`,
      );

      if (spaceUserId && spaceUserId !== userId) {
        void this.notificationsService
          .create(
            spaceUserId,
            'space_host_deal_report_reviewed',
            communityName,
            `${communityStatus === 'approved' ? 'Approved' : 'Requested changes to'} your deliverables report`,
            { spaceHostInterestId: interest.id },
          )
          .catch(() => undefined);
      }
    }

    const proofUrls = await Promise.all(
      (report.proofKeys ?? []).filter(Boolean).map(async (key) => {
        try {
          return await this.storageService.getPresignedDownloadUrl(key);
        } catch {
          return '';
        }
      }),
    );
    return { ...report, proofUrls };
  }
}
