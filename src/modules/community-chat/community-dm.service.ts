import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DirectMessagePolicy } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const DM_MESSAGE_SELECT = {
  id: true,
  conversationId: true,
  senderId: true,
  content: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  sender: {
    select: { id: true, firstName: true, lastName: true, avatarUrl: true },
  },
};

@Injectable()
export class CommunityDmService {
  constructor(private readonly prisma: PrismaService) {}

  async checkDmPolicy(
    communityId: string,
    userId: string,
    targetUserId: string,
  ): Promise<void> {
    const settings = await this.prisma.communitySettings.findUnique({
      where: { communityId },
      select: { dmPolicy: true },
    });

    if (!settings || settings.dmPolicy === DirectMessagePolicy.DISABLED) {
      throw new ForbiddenException('Direct messages are disabled in this community');
    }

    if (settings.dmPolicy === DirectMessagePolicy.MUTUAL_ATTENDEES_ONLY) {
      // Collect event IDs in this community that userId attended
      const userAttendances = await this.prisma.orderAttendee.findMany({
        where: {
          userId,
          orderItem: {
            order: {
              event: { communities: { some: { communityId } } },
            },
          },
        },
        select: { orderItem: { select: { order: { select: { eventId: true } } } } },
      });
      const userEventIds = new Set(
        userAttendances.map((a) => a.orderItem.order.eventId),
      );

      if (userEventIds.size === 0) {
        throw new ForbiddenException(
          'You must have attended a common event to message this member',
        );
      }

      // Check if targetUser attended any of those events
      const sharedAttendance = await this.prisma.orderAttendee.findFirst({
        where: {
          userId: targetUserId,
          orderItem: {
            order: { eventId: { in: Array.from(userEventIds) } },
          },
        },
        select: { id: true },
      });

      if (!sharedAttendance) {
        throw new ForbiddenException(
          'You must have attended a common event to message this member',
        );
      }
    }
  }

  async findOrCreateConversation(
    communityId: string,
    userId: string,
    targetUserId: string,
  ) {
    const [p1, p2] = [userId, targetUserId].sort();

    return this.prisma.communityDmConversation.upsert({
      where: {
        communityId_participant1Id_participant2Id: {
          communityId,
          participant1Id: p1,
          participant2Id: p2,
        },
      },
      create: { communityId, participant1Id: p1, participant2Id: p2 },
      update: {},
    });
  }

  async createMessage(conversationId: string, senderId: string, content: string) {
    const preview = content.length > 80 ? content.slice(0, 77) + '...' : content;

    const [message] = await this.prisma.$transaction([
      this.prisma.communityDmMessage.create({
        data: { conversationId, senderId, content },
        select: DM_MESSAGE_SELECT,
      }),
      this.prisma.communityDmConversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date(), lastMessagePreview: preview },
      }),
    ]);

    return message;
  }

  async listConversations(communityId: string, userId: string) {
    const convos = await this.prisma.communityDmConversation.findMany({
      where: {
        communityId,
        OR: [{ participant1Id: userId }, { participant2Id: userId }],
      },
      orderBy: { lastMessageAt: 'desc' },
      include: {
        participant1: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true },
        },
        participant2: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true },
        },
        readStates: {
          where: { userId },
          select: { lastReadAt: true },
        },
      },
    });

    return Promise.all(
      convos.map(async (c) => {
        const myReadState = c.readStates[0];
        const unreadCount = myReadState?.lastReadAt
          ? await this.prisma.communityDmMessage.count({
              where: {
                conversationId: c.id,
                senderId: { not: userId },
                deletedAt: null,
                createdAt: { gt: myReadState.lastReadAt },
              },
            })
          : await this.prisma.communityDmMessage.count({
              where: { conversationId: c.id, senderId: { not: userId }, deletedAt: null },
            });

        const other = c.participant1Id === userId ? c.participant2 : c.participant1;

        return {
          id: c.id,
          communityId: c.communityId,
          other,
          lastMessageAt: c.lastMessageAt,
          lastMessagePreview: c.lastMessagePreview,
          unreadCount,
        };
      }),
    );
  }

  async getDmHistory(conversationId: string, userId: string, cursor?: string, limit = 30) {
    const convo = await this.prisma.communityDmConversation.findUnique({
      where: { id: conversationId },
      select: { participant1Id: true, participant2Id: true },
    });

    if (!convo || (convo.participant1Id !== userId && convo.participant2Id !== userId)) {
      throw new NotFoundException('Conversation not found');
    }

    const messages = await this.prisma.communityDmMessage.findMany({
      where: {
        conversationId,
        deletedAt: null,
        ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      select: DM_MESSAGE_SELECT,
    });

    const hasMore = messages.length > limit;
    const data = hasMore ? messages.slice(0, limit) : messages;
    const nextCursor = hasMore ? data[data.length - 1].createdAt.toISOString() : null;

    return { messages: data, nextCursor };
  }

  async getTotalUnreadDmCount(communityId: string, userId: string): Promise<number> {
    const convos = await this.prisma.communityDmConversation.findMany({
      where: {
        communityId,
        OR: [{ participant1Id: userId }, { participant2Id: userId }],
      },
      select: {
        id: true,
        readStates: { where: { userId }, select: { lastReadAt: true } },
      },
    });

    const counts = await Promise.all(
      convos.map((c) => {
        const readAt = c.readStates[0]?.lastReadAt;
        return this.prisma.communityDmMessage.count({
          where: {
            conversationId: c.id,
            senderId: { not: userId },
            deletedAt: null,
            ...(readAt ? { createdAt: { gt: readAt } } : {}),
          },
        });
      }),
    );

    return counts.reduce((sum, n) => sum + n, 0);
  }
}
