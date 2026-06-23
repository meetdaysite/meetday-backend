import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, CommunityRole } from '@prisma/client';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';

const ROLE_HIERARCHY: CommunityRole[] = [
  CommunityRole.MEMBER,
  CommunityRole.MODERATOR,
  CommunityRole.HOST,
  CommunityRole.MANAGER,
  CommunityRole.OWNER,
];

function hasMinRole(role: CommunityRole, min: CommunityRole): boolean {
  return ROLE_HIERARCHY.indexOf(role) >= ROLE_HIERARCHY.indexOf(min);
}

const MESSAGE_SELECT = {
  id: true,
  channelId: true,
  communityId: true,
  senderId: true,
  content: true,
  isPinned: true,
  pinnedAt: true,
  pinnedBy: true,
  parentMessageId: true,
  replyCount: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  sender: {
    select: { id: true, firstName: true, lastName: true, avatarUrl: true },
  },
  pinnedByUser: {
    select: { id: true, firstName: true, lastName: true },
  },
  reactions: {
    select: { userId: true, emoji: true },
  },
};

@Injectable()
export class CommunityChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async createMessage(
    channelId: string,
    communityId: string,
    senderId: string,
    content: string,
    parentMessageId?: string,
  ) {
    if (parentMessageId) {
      const parent = await this.prisma.channelMessage.findFirst({
        where: { id: parentMessageId, channelId, deletedAt: null },
        select: { id: true },
      });
      if (!parent) throw new NotFoundException('Parent message not found in this channel');
    }

    const message = await this.prisma.$transaction(async (tx) => {
      const msg = await tx.channelMessage.create({
        data: { channelId, communityId, senderId, content, parentMessageId },
        select: MESSAGE_SELECT,
      });

      if (parentMessageId) {
        await tx.channelMessage.update({
          where: { id: parentMessageId },
          data: { replyCount: { increment: 1 } },
        });
      }

      return msg;
    });

    return message;
  }

  async getMessageHistory(
    channelId: string,
    cursor?: string,
    limit = 30,
  ) {
    const messages = await this.prisma.channelMessage.findMany({
      where: {
        channelId,
        deletedAt: null,
        parentMessageId: null,
        ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      select: MESSAGE_SELECT,
    });

    const hasMore = messages.length > limit;
    const data = hasMore ? messages.slice(0, limit) : messages;
    const nextCursor = hasMore ? data[data.length - 1].createdAt.toISOString() : null;

    return { messages: data, nextCursor };
  }

  async getReplies(parentMessageId: string, cursor?: string, limit = 30) {
    const messages = await this.prisma.channelMessage.findMany({
      where: {
        parentMessageId,
        deletedAt: null,
        ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: limit + 1,
      select: MESSAGE_SELECT,
    });

    const hasMore = messages.length > limit;
    const data = hasMore ? messages.slice(0, limit) : messages;
    const nextCursor = hasMore ? data[data.length - 1].createdAt.toISOString() : null;

    return { messages: data, nextCursor };
  }

  async getPinnedMessages(channelId: string) {
    return this.prisma.channelMessage.findMany({
      where: { channelId, isPinned: true, deletedAt: null },
      orderBy: { pinnedAt: 'desc' },
      select: MESSAGE_SELECT,
    });
  }

  async pinMessage(
    messageId: string,
    channelId: string,
    pinnedBy: string,
  ) {
    const msg = await this.findMessageOrThrow(messageId, channelId);

    const updated = await this.prisma.channelMessage.update({
      where: { id: messageId },
      data: { isPinned: true, pinnedAt: new Date(), pinnedBy },
      select: MESSAGE_SELECT,
    });

    this.auditLog.log({
      actorId: pinnedBy,
      action: AuditAction.CHAT_MESSAGE_PINNED,
      entityType: 'ChannelMessage',
      entityId: messageId,
      metadata: { channelId, communityId: msg.communityId },
    });

    return updated;
  }

  async unpinMessage(messageId: string, channelId: string, actorId: string) {
    const msg = await this.findMessageOrThrow(messageId, channelId);

    const updated = await this.prisma.channelMessage.update({
      where: { id: messageId },
      data: { isPinned: false, pinnedAt: null, pinnedBy: null },
      select: MESSAGE_SELECT,
    });

    this.auditLog.log({
      actorId,
      action: AuditAction.CHAT_MESSAGE_UNPINNED,
      entityType: 'ChannelMessage',
      entityId: messageId,
      metadata: { channelId, communityId: msg.communityId },
    });

    return updated;
  }

  async softDeleteMessage(
    messageId: string,
    channelId: string,
    actorUserId: string,
    actorCommunityRole: CommunityRole,
  ) {
    const msg = await this.findMessageOrThrow(messageId, channelId);

    const isSender = msg.senderId === actorUserId;
    const isModerator = hasMinRole(actorCommunityRole, CommunityRole.MODERATOR);

    if (!isSender && !isModerator) {
      throw new ForbiddenException("Cannot delete another member's message");
    }

    await this.prisma.channelMessage.update({
      where: { id: messageId },
      data: { deletedAt: new Date() },
    });

    if (!isSender) {
      this.auditLog.log({
        actorId: actorUserId,
        action: AuditAction.CHAT_MESSAGE_DELETED_BY_MOD,
        entityType: 'ChannelMessage',
        entityId: messageId,
        metadata: { channelId, communityId: msg.communityId, originalSenderId: msg.senderId },
      });
    }

    // Decrement replyCount on parent if this was a reply
    if (msg.parentMessageId) {
      await this.prisma.channelMessage.update({
        where: { id: msg.parentMessageId },
        data: { replyCount: { decrement: 1 } },
      });
    }

    return { messageId, channelId };
  }

  async getAggregatedReactions(
    messageId: string,
  ): Promise<Array<{ emoji: string; count: number; userIds: string[] }>> {
    const reactions = await this.prisma.messageReaction.findMany({
      where: { messageId },
      select: { emoji: true, userId: true },
    });

    const map = new Map<string, string[]>();
    for (const r of reactions) {
      const existing = map.get(r.emoji) ?? [];
      existing.push(r.userId);
      map.set(r.emoji, existing);
    }

    return Array.from(map.entries()).map(([emoji, userIds]) => ({
      emoji,
      count: userIds.length,
      userIds,
    }));
  }

  async dismissBanner(channelId: string, userId: string) {
    await this.prisma.channelMemberState.upsert({
      where: { channelId_userId: { channelId, userId } },
      create: { channelId, userId, bannerDismissedAt: new Date() },
      update: { bannerDismissedAt: new Date() },
    });
    return { success: true };
  }

  private async findMessageOrThrow(messageId: string, channelId: string) {
    const msg = await this.prisma.channelMessage.findFirst({
      where: { id: messageId, channelId, deletedAt: null },
      select: {
        id: true,
        channelId: true,
        communityId: true,
        senderId: true,
        parentMessageId: true,
      },
    });
    if (!msg) throw new NotFoundException('Message not found');
    return msg;
  }
}
