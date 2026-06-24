import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CommunityMemberStatus, DirectMessagePolicy, DmConversationStatus, DmMessageType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { E2eeService } from '../e2ee/e2ee.service';
import { StorageService } from '../../common/storage/storage.service';

const USER_SELECT = {
  select: { id: true, firstName: true, lastName: true, avatarUrl: true },
} as const;

// The server only ever stores/returns opaque ciphertext — never plaintext.
const DM_MESSAGE_SELECT = {
  id: true,
  conversationId: true,
  senderId: true,
  ciphertext: true,
  nonce: true,
  keyEpoch: true,
  messageType: true,
  mediaKey: true,
  mediaSizeBytes: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  sender: USER_SELECT,
};

/** Opaque encrypted message payload — produced and read only by clients. */
export interface EncryptedMessagePayload {
  ciphertext: string;
  nonce: string;
  keyEpoch: number;
  messageType?: DmMessageType;
  mediaKey?: string;
  mediaSizeBytes?: number;
}

export interface ConversationKeyWraps {
  deviceWraps?: { recipientUserId: string; recipientDeviceId: string; epoch: number; wrappedKey: string }[];
  masterWraps?: { userId: string; epoch: number; wrappedKey: string }[];
}

export type DmStatusForViewer = 'none' | 'intro_sent' | 'intro_received' | 'connected';

@Injectable()
export class CommunityDmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly e2ee: E2eeService,
    private readonly storage: StorageService,
  ) {}

  /** Attach a presigned GET url for an IMAGE message's encrypted blob (safe — ciphertext). */
  private async withMediaUrl<T extends { mediaKey: string | null }>(
    message: T,
  ): Promise<T & { mediaUrl: string | null }> {
    const mediaUrl = message.mediaKey
      ? await this.storage.getPresignedDownloadUrl(message.mediaKey)
      : null;
    return { ...message, mediaUrl };
  }

  // ─── Policy ─────────────────────────────────────────────────────────────────

  async checkDmPolicy(communityId: string, userId: string, targetUserId: string): Promise<void> {
    const settings = await this.prisma.communitySettings.findUnique({
      where: { communityId },
      select: { dmPolicy: true },
    });

    if (!settings || settings.dmPolicy === DirectMessagePolicy.DISABLED) {
      throw new ForbiddenException('Direct messages are disabled in this community');
    }

    if (settings.dmPolicy === DirectMessagePolicy.MUTUAL_ATTENDEES_ONLY) {
      const userAttendances = await this.prisma.orderAttendee.findMany({
        where: {
          userId,
          orderItem: { order: { event: { communities: { some: { communityId } } } } },
        },
        select: { orderItem: { select: { order: { select: { eventId: true } } } } },
      });
      const userEventIds = new Set(userAttendances.map((a) => a.orderItem.order.eventId));

      if (userEventIds.size === 0) {
        throw new ForbiddenException('You must have attended a common event to message this member');
      }

      const sharedAttendance = await this.prisma.orderAttendee.findFirst({
        where: {
          userId: targetUserId,
          orderItem: { order: { eventId: { in: Array.from(userEventIds) } } },
        },
        select: { id: true },
      });

      if (!sharedAttendance) {
        throw new ForbiddenException('You must have attended a common event to message this member');
      }
    }
  }

  // ─── Intro lifecycle ────────────────────────────────────────────────────────

  async createIntro(
    communityId: string,
    initiatorId: string,
    targetUserId: string,
    payload: EncryptedMessagePayload,
    wraps: ConversationKeyWraps,
  ) {
    if (initiatorId === targetUserId) {
      throw new BadRequestException('You cannot send an intro to yourself');
    }

    await this.checkDmPolicy(communityId, initiatorId, targetUserId);

    const targetMember = await this.prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId, userId: targetUserId } },
      select: { status: true },
    });
    if (!targetMember || targetMember.status !== CommunityMemberStatus.ACTIVE) {
      throw new NotFoundException('Member not found in this community');
    }

    const [p1, p2] = [initiatorId, targetUserId].sort();
    const existing = await this.prisma.communityDmConversation.findUnique({
      where: { communityId_participant1Id_participant2Id: { communityId, participant1Id: p1, participant2Id: p2 } },
      select: { id: true, status: true },
    });

    let conversationId: string;
    if (!existing) {
      const convo = await this.prisma.communityDmConversation.create({
        data: { communityId, participant1Id: p1, participant2Id: p2, status: DmConversationStatus.PENDING, initiatorId },
        select: { id: true },
      });
      conversationId = convo.id;
    } else if (existing.status === DmConversationStatus.ACCEPTED) {
      throw new ConflictException('You are already connected with this member');
    } else if (existing.status === DmConversationStatus.PENDING) {
      throw new ConflictException('An intro is already pending with this member');
    } else {
      // REJECTED → reset to a fresh pending intro (re-intro is allowed). Stale
      // messages and conversation keys are cleared — a new K is established.
      await this.prisma.$transaction([
        this.prisma.communityDmMessage.deleteMany({ where: { conversationId: existing.id } }),
        this.prisma.dmConversationDeviceKey.deleteMany({ where: { conversationId: existing.id } }),
        this.prisma.dmConversationMasterKey.deleteMany({ where: { conversationId: existing.id } }),
        this.prisma.communityDmConversation.update({
          where: { id: existing.id },
          data: { status: DmConversationStatus.PENDING, initiatorId, respondedAt: null, lastMessageAt: null },
        }),
      ]);
      conversationId = existing.id;
    }

    // Persist the conversation-key wraps so both participants' devices can unwrap K.
    await this.persistKeyWraps(conversationId, wraps);

    const introMessage = await this.insertMessage(conversationId, initiatorId, payload);

    const initiator = await this.prisma.user.findUnique({ where: { id: initiatorId }, ...USER_SELECT });

    // Generic notification only — never include message content (zero-knowledge E2EE).
    await this.notifications.create(
      targetUserId,
      'community_intro_received',
      `${initiator?.firstName ?? 'Someone'} wants to connect`,
      'Sent you an introduction',
      { communityId, conversationId, fromUserId: initiatorId },
    );

    return { conversationId, recipientId: targetUserId, message: introMessage, initiator };
  }

  async acceptIntro(conversationId: string, userId: string) {
    const convo = await this.loadForResponse(conversationId);
    this.assertRecipient(convo, userId);
    if (convo.status !== DmConversationStatus.PENDING) {
      throw new ConflictException('This intro is no longer pending');
    }

    await this.prisma.communityDmConversation.update({
      where: { id: conversationId },
      data: { status: DmConversationStatus.ACCEPTED, respondedAt: new Date() },
    });

    const accepter = await this.prisma.user.findUnique({ where: { id: userId }, ...USER_SELECT });

    await this.notifications.create(
      convo.initiatorId,
      'community_intro_accepted',
      `${accepter?.firstName ?? 'Someone'} accepted your intro`,
      'You can now message each other.',
      { communityId: convo.communityId, conversationId },
    );

    return { conversationId, initiatorId: convo.initiatorId, accepter };
  }

  async rejectIntro(conversationId: string, userId: string) {
    const convo = await this.loadForResponse(conversationId);
    this.assertRecipient(convo, userId);
    if (convo.status !== DmConversationStatus.PENDING) {
      throw new ConflictException('This intro is no longer pending');
    }

    await this.prisma.communityDmConversation.update({
      where: { id: conversationId },
      data: { status: DmConversationStatus.REJECTED, respondedAt: new Date() },
    });

    // Silent — the initiator is not notified.
    return { success: true };
  }

  async listReceivedIntros(communityId: string, userId: string) {
    const convos = await this.prisma.communityDmConversation.findMany({
      where: {
        communityId,
        status: DmConversationStatus.PENDING,
        initiatorId: { not: userId },
        OR: [{ participant1Id: userId }, { participant2Id: userId }],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        participant1: USER_SELECT,
        participant2: USER_SELECT,
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: DM_MESSAGE_SELECT },
      },
    });

    return Promise.all(
      convos.map(async (c) => {
        const from = c.participant1.id === c.initiatorId ? c.participant1 : c.participant2;
        return {
          conversationId: c.id,
          from,
          // Encrypted intro message — client decrypts after fetching its key wrap.
          message: c.messages[0] ? await this.withMediaUrl(c.messages[0]) : null,
          sentAt: c.messages[0]?.createdAt ?? c.createdAt,
          sharedInterests: await this.sharedInterests(userId, from.id),
        };
      }),
    );
  }

  async listSentIntros(communityId: string, userId: string) {
    const convos = await this.prisma.communityDmConversation.findMany({
      where: { communityId, status: DmConversationStatus.PENDING, initiatorId: userId },
      orderBy: { createdAt: 'desc' },
      include: {
        participant1: USER_SELECT,
        participant2: USER_SELECT,
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: DM_MESSAGE_SELECT },
      },
    });

    return Promise.all(
      convos.map(async (c) => {
        const to = c.participant1.id === c.initiatorId ? c.participant2 : c.participant1;
        return {
          conversationId: c.id,
          to,
          message: c.messages[0] ? await this.withMediaUrl(c.messages[0]) : null,
          sentAt: c.messages[0]?.createdAt ?? c.createdAt,
        };
      }),
    );
  }

  async getDmStatusFor(communityId: string, viewerId: string, targetUserId: string): Promise<DmStatusForViewer> {
    const [p1, p2] = [viewerId, targetUserId].sort();
    const convo = await this.prisma.communityDmConversation.findUnique({
      where: { communityId_participant1Id_participant2Id: { communityId, participant1Id: p1, participant2Id: p2 } },
      select: { status: true, initiatorId: true },
    });
    if (!convo) return 'none';
    if (convo.status === DmConversationStatus.ACCEPTED) return 'connected';
    if (convo.status === DmConversationStatus.PENDING) {
      return convo.initiatorId === viewerId ? 'intro_sent' : 'intro_received';
    }
    return 'none'; // REJECTED → re-intro allowed, so present as "none"
  }

  // ─── Messaging (ACCEPTED only) ──────────────────────────────────────────────

  async createMessage(conversationId: string, senderId: string, payload: EncryptedMessagePayload) {
    const convo = await this.prisma.communityDmConversation.findUnique({
      where: { id: conversationId },
      select: { status: true, participant1Id: true, participant2Id: true },
    });
    if (!convo) throw new NotFoundException('Conversation not found');

    const isParticipant = senderId === convo.participant1Id || senderId === convo.participant2Id;
    if (!isParticipant) throw new ForbiddenException('Not a participant in this conversation');
    if (convo.status !== DmConversationStatus.ACCEPTED) {
      throw new ForbiddenException('This conversation is not active — the intro must be accepted first');
    }

    return this.insertMessage(conversationId, senderId, payload);
  }

  async listConversations(communityId: string, userId: string) {
    const convos = await this.prisma.communityDmConversation.findMany({
      where: {
        communityId,
        status: DmConversationStatus.ACCEPTED,
        OR: [{ participant1Id: userId }, { participant2Id: userId }],
      },
      orderBy: { lastMessageAt: 'desc' },
      include: {
        participant1: USER_SELECT,
        participant2: USER_SELECT,
        readStates: { where: { userId }, select: { lastReadAt: true } },
      },
    });

    return Promise.all(
      convos.map(async (c) => {
        const myReadState = c.readStates[0];
        const unreadCount = await this.prisma.communityDmMessage.count({
          where: {
            conversationId: c.id,
            senderId: { not: userId },
            deletedAt: null,
            ...(myReadState?.lastReadAt ? { createdAt: { gt: myReadState.lastReadAt } } : {}),
          },
        });

        const other = c.participant1Id === userId ? c.participant2 : c.participant1;

        return {
          id: c.id,
          communityId: c.communityId,
          other,
          lastMessageAt: c.lastMessageAt,
          // No server-side preview under E2EE — client renders from local decrypted cache.
          unreadCount,
        };
      }),
    );
  }

  async getDmHistory(conversationId: string, userId: string, cursor?: string, limit = 30) {
    const convo = await this.prisma.communityDmConversation.findUnique({
      where: { id: conversationId },
      select: { status: true, participant1Id: true, participant2Id: true },
    });

    if (!convo || (convo.participant1Id !== userId && convo.participant2Id !== userId)) {
      throw new NotFoundException('Conversation not found');
    }
    if (convo.status !== DmConversationStatus.ACCEPTED) {
      throw new ForbiddenException('This conversation is not active yet');
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

    return { messages: await Promise.all(data.map((m) => this.withMediaUrl(m))), nextCursor };
  }

  async getTotalUnreadDmCount(communityId: string, userId: string): Promise<number> {
    const convos = await this.prisma.communityDmConversation.findMany({
      where: {
        communityId,
        status: DmConversationStatus.ACCEPTED,
        OR: [{ participant1Id: userId }, { participant2Id: userId }],
      },
      select: { id: true, readStates: { where: { userId }, select: { lastReadAt: true } } },
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

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async insertMessage(conversationId: string, senderId: string, payload: EncryptedMessagePayload) {
    const [message] = await this.prisma.$transaction([
      this.prisma.communityDmMessage.create({
        data: {
          conversationId,
          senderId,
          ciphertext: payload.ciphertext,
          nonce: payload.nonce,
          keyEpoch: payload.keyEpoch,
          messageType: payload.messageType ?? DmMessageType.TEXT,
          mediaKey: payload.mediaKey,
          mediaSizeBytes: payload.mediaSizeBytes,
        },
        select: DM_MESSAGE_SELECT,
      }),
      this.prisma.communityDmConversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date() },
      }),
    ]);

    return this.withMediaUrl(message);
  }

  // ─── Conversation key wraps (E2EE) ──────────────────────────────────────────

  /** A participant uploads K wraps for participant devices (+ optional master wraps). */
  async uploadConversationKeys(conversationId: string, callerId: string, wraps: ConversationKeyWraps) {
    await this.assertParticipant(conversationId, callerId);
    await this.persistKeyWraps(conversationId, wraps);
    return { success: true };
  }

  /** Fetch the wrap(s) addressed to my device + my master wrap, so I can unwrap K. */
  async getConversationKeysForDevice(conversationId: string, callerId: string, deviceId: string) {
    await this.assertParticipant(conversationId, callerId);

    const device = await this.prisma.userDevice.findUnique({
      where: { userId_deviceId: { userId: callerId, deviceId } },
      select: { id: true },
    });
    if (!device) throw new NotFoundException('Device not found for this user');

    const [deviceKeys, masterKeys] = await Promise.all([
      this.prisma.dmConversationDeviceKey.findMany({
        where: { conversationId, recipientDeviceId: deviceId, recipientUserId: callerId },
        orderBy: { epoch: 'desc' },
        select: { epoch: true, wrappedKey: true },
      }),
      this.prisma.dmConversationMasterKey.findMany({
        where: { conversationId, userId: callerId },
        orderBy: { epoch: 'desc' },
        select: { epoch: true, wrappedKey: true },
      }),
    ]);

    return { deviceKeys, masterKeys };
  }

  /** Active device public keys for a community member — the bundle to wrap K to. */
  async getMemberDeviceKeys(communityId: string, targetUserId: string) {
    const member = await this.prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId, userId: targetUserId } },
      select: { status: true },
    });
    if (!member || member.status !== CommunityMemberStatus.ACTIVE) {
      throw new NotFoundException('Member not found in this community');
    }
    return this.e2ee.getActiveDeviceKeys(targetUserId);
  }

  private async persistKeyWraps(conversationId: string, wraps: ConversationKeyWraps) {
    const ops: Prisma.PrismaPromise<unknown>[] = [];

    for (const w of wraps.deviceWraps ?? []) {
      ops.push(
        this.prisma.dmConversationDeviceKey.upsert({
          where: {
            conversationId_recipientDeviceId_epoch: {
              conversationId,
              recipientDeviceId: w.recipientDeviceId,
              epoch: w.epoch,
            },
          },
          create: {
            conversationId,
            recipientUserId: w.recipientUserId,
            recipientDeviceId: w.recipientDeviceId,
            epoch: w.epoch,
            wrappedKey: w.wrappedKey,
          },
          update: { wrappedKey: w.wrappedKey, recipientUserId: w.recipientUserId },
        }),
      );
    }

    for (const w of wraps.masterWraps ?? []) {
      ops.push(
        this.prisma.dmConversationMasterKey.upsert({
          where: { conversationId_userId_epoch: { conversationId, userId: w.userId, epoch: w.epoch } },
          create: { conversationId, userId: w.userId, epoch: w.epoch, wrappedKey: w.wrappedKey },
          update: { wrappedKey: w.wrappedKey },
        }),
      );
    }

    if (ops.length > 0) await this.prisma.$transaction(ops);
  }

  private async assertParticipant(conversationId: string, userId: string) {
    const convo = await this.prisma.communityDmConversation.findUnique({
      where: { id: conversationId },
      select: { participant1Id: true, participant2Id: true },
    });
    if (!convo || (convo.participant1Id !== userId && convo.participant2Id !== userId)) {
      throw new NotFoundException('Conversation not found');
    }
    return convo;
  }

  private async loadForResponse(conversationId: string) {
    const convo = await this.prisma.communityDmConversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        communityId: true,
        status: true,
        initiatorId: true,
        participant1Id: true,
        participant2Id: true,
      },
    });
    if (!convo) throw new NotFoundException('Intro not found');
    return convo;
  }

  private assertRecipient(
    convo: { initiatorId: string; participant1Id: string; participant2Id: string },
    userId: string,
  ): void {
    const isParticipant = userId === convo.participant1Id || userId === convo.participant2Id;
    if (!isParticipant || userId === convo.initiatorId) {
      throw new ForbiddenException('Only the recipient of the intro can respond');
    }
  }

  private async sharedInterests(userA: string, userB: string): Promise<{ count: number; tags: { id: string; name: string }[] }> {
    const rows = await this.prisma.userInterestAffinity.findMany({
      where: { userId: { in: [userA, userB] }, affinity: { not: 'DISLIKED' } },
      select: { userId: true, interest: { select: { id: true, name: true } } },
    });
    const aIds = new Set(rows.filter((r) => r.userId === userA).map((r) => r.interest.id));
    const seen = new Set<string>();
    const tags: { id: string; name: string }[] = [];
    for (const r of rows) {
      if (r.userId === userB && aIds.has(r.interest.id) && !seen.has(r.interest.id)) {
        seen.add(r.interest.id);
        tags.push(r.interest);
      }
    }
    return { count: tags.length, tags: tags.slice(0, 3) };
  }
}
