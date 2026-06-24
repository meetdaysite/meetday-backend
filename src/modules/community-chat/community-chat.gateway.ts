import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import * as firebaseAdmin from 'firebase-admin';
import { Namespace, Socket } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service';
import { CommunityChatService } from './community-chat.service';
import { CommunityDmService } from './community-dm.service';
import { CommunityPresenceService } from './community-presence.service';
import {
  CommunityMemberStatus,
  CommunityRole,
  ChatPermission,
  DmMessageType,
} from '@prisma/client';

interface ConnectedUser {
  userId: string;
  communityIds: Set<string>;
}

const TYPING_TIMEOUT_MS = 3000;

@WebSocketGateway({
  namespace: '/community-chat',
  cors: {
    origin: process.env.NODE_ENV === 'production' ? process.env.FRONTEND_URL : true,
    credentials: true,
  },
})
export class CommunityChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Namespace;

  private readonly logger = new Logger(CommunityChatGateway.name);
  private readonly connectedUsers = new Map<string, ConnectedUser>();
  private readonly typingTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly chatService: CommunityChatService,
    private readonly dmService: CommunityDmService,
    private readonly presenceService: CommunityPresenceService,
  ) {}

  afterInit(_namespace: Namespace) {
    // Redis adapter already initialized by NotificationsGateway — do not reinitialize here
    this.logger.log('CommunityChatGateway initialized');
  }

  async handleConnection(client: Socket) {
    const token = (client.handshake.auth?.token ?? client.handshake.query?.token) as
      | string
      | undefined;

    if (!token) {
      this.logger.warn(`Socket rejected: no token socketId=${client.id}`);
      client.disconnect();
      return;
    }

    try {
      const decoded = await firebaseAdmin.auth().verifyIdToken(token);
      const user = await this.prisma.user.findUnique({
        where: { firebaseUid: decoded.uid },
        select: { id: true },
      });

      if (!user) {
        this.logger.warn(`Socket rejected: no DB user uid=${decoded.uid}`);
        client.disconnect();
        return;
      }

      client.data.userId = user.id;
      client.join(`user:${user.id}`);

      this.connectedUsers.set(client.id, {
        userId: user.id,
        communityIds: new Set(),
      });

      this.logger.log(`Connected: userId=${user.id} socketId=${client.id}`);
    } catch (err) {
      this.logger.warn(`Socket rejected: ${(err as Error).message}`);
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    const entry = this.connectedUsers.get(client.id);
    if (!entry) return;

    // Clean up typing timers for this user
    for (const [key, timer] of this.typingTimers.entries()) {
      if (key.endsWith(`:${entry.userId}`)) {
        clearTimeout(timer);
        this.typingTimers.delete(key);
      }
    }

    // Remove from presence sets
    for (const communityId of entry.communityIds) {
      await this.presenceService.userLeft(communityId, entry.userId);
      const presence = await this.presenceService.getPresence(communityId);
      this.server.to(`community:${communityId}`).emit('presence-update', {
        communityId,
        ...presence,
      });
    }

    this.connectedUsers.delete(client.id);
    this.logger.log(`Disconnected: userId=${entry.userId} socketId=${client.id}`);
  }

  // ─── Channel Membership ───────────────────────────────────────────────────

  @SubscribeMessage('join-channel')
  async handleJoinChannel(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { channelId: string; communityId: string },
  ) {
    const entry = this.connectedUsers.get(client.id);
    if (!entry) return;

    const isMember = await this.verifyActiveMember(payload.communityId, entry.userId);
    if (!isMember) {
      client.emit('error', { event: 'join-channel', message: 'Not a member of this community' });
      return;
    }

    client.join(`channel:${payload.channelId}`);
    client.join(`community:${payload.communityId}`);

    if (!entry.communityIds.has(payload.communityId)) {
      entry.communityIds.add(payload.communityId);
      await this.presenceService.userJoined(payload.communityId, entry.userId);
      const presence = await this.presenceService.getPresence(payload.communityId);
      this.server.to(`community:${payload.communityId}`).emit('presence-update', {
        communityId: payload.communityId,
        ...presence,
      });
    }
  }

  @SubscribeMessage('leave-channel')
  handleLeaveChannel(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { channelId: string },
  ) {
    client.leave(`channel:${payload.channelId}`);
  }

  // ─── Messages ─────────────────────────────────────────────────────────────

  @SubscribeMessage('send-message')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: { channelId: string; content: string; parentMessageId?: string },
  ) {
    const entry = this.connectedUsers.get(client.id);
    if (!entry) return;

    const channel = await this.prisma.communityChannel.findFirst({
      where: { id: payload.channelId, deletedAt: null },
      include: {
        community: { include: { settings: { select: { chatEnabled: true, chat: true } } } },
      },
    });

    if (!channel) {
      client.emit('error', { event: 'send-message', message: 'Channel not found' });
      return;
    }

    const settings = channel.community.settings;
    if (!settings?.chatEnabled) {
      client.emit('error', { event: 'send-message', message: 'Chat is disabled' });
      return;
    }

    if (settings.chat === ChatPermission.ADMIN_APPROVAL_REQUIRED) {
      const member = await this.prisma.communityMember.findUnique({
        where: {
          communityId_userId: {
            communityId: channel.communityId,
            userId: entry.userId,
          },
        },
        select: { role: true },
      });
      const moderatorRoles: CommunityRole[] = [
        CommunityRole.MODERATOR,
        CommunityRole.HOST,
        CommunityRole.MANAGER,
        CommunityRole.OWNER,
      ];
      if (!member || !moderatorRoles.includes(member.role)) {
        client.emit('error', { event: 'send-message', message: 'Posting requires moderator role' });
        return;
      }
    }

    // Clear typing timer for this user+channel
    const typingKey = `channel:${payload.channelId}:${entry.userId}`;
    const existingTimer = this.typingTimers.get(typingKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.typingTimers.delete(typingKey);
    }

    const message = await this.chatService.createMessage(
      payload.channelId,
      channel.communityId,
      entry.userId,
      payload.content,
      payload.parentMessageId,
    );

    await this.presenceService.refreshTtl(channel.communityId);

    this.server.to(`channel:${payload.channelId}`).emit('new-message', {
      channelId: payload.channelId,
      message,
    });
  }

  // ─── Reactions ────────────────────────────────────────────────────────────

  @SubscribeMessage('add-reaction')
  async handleAddReaction(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { messageId: string; emoji: string },
  ) {
    const entry = this.connectedUsers.get(client.id);
    if (!entry) return;

    try {
      await this.prisma.messageReaction.create({
        data: { messageId: payload.messageId, userId: entry.userId, emoji: payload.emoji },
      });
    } catch {
      // Unique constraint — already reacted with this emoji
    }

    const reactions = await this.chatService.getAggregatedReactions(payload.messageId);
    const message = await this.prisma.channelMessage.findUnique({
      where: { id: payload.messageId },
      select: { channelId: true },
    });
    if (message) {
      this.server
        .to(`channel:${message.channelId}`)
        .emit('reaction-updated', { messageId: payload.messageId, reactions });
    }
  }

  @SubscribeMessage('remove-reaction')
  async handleRemoveReaction(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { messageId: string; emoji: string },
  ) {
    const entry = this.connectedUsers.get(client.id);
    if (!entry) return;

    await this.prisma.messageReaction.deleteMany({
      where: { messageId: payload.messageId, userId: entry.userId, emoji: payload.emoji },
    });

    const reactions = await this.chatService.getAggregatedReactions(payload.messageId);
    const message = await this.prisma.channelMessage.findUnique({
      where: { id: payload.messageId },
      select: { channelId: true },
    });
    if (message) {
      this.server
        .to(`channel:${message.channelId}`)
        .emit('reaction-updated', { messageId: payload.messageId, reactions });
    }
  }

  // ─── Typing ───────────────────────────────────────────────────────────────

  @SubscribeMessage('typing-start')
  async handleTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { channelId: string },
  ) {
    const entry = this.connectedUsers.get(client.id);
    if (!entry) return;

    const user = await this.prisma.user.findUnique({
      where: { id: entry.userId },
      select: { firstName: true, lastName: true },
    });

    client.to(`channel:${payload.channelId}`).emit('typing', {
      channelId: payload.channelId,
      userId: entry.userId,
      displayName: user ? `${user.firstName} ${user.lastName}` : 'Someone',
    });

    const timerKey = `channel:${payload.channelId}:${entry.userId}`;
    const existing = this.typingTimers.get(timerKey);
    if (existing) clearTimeout(existing);

    this.typingTimers.set(
      timerKey,
      setTimeout(() => this.typingTimers.delete(timerKey), TYPING_TIMEOUT_MS),
    );
  }

  @SubscribeMessage('typing-stop')
  handleTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { channelId: string },
  ) {
    const entry = this.connectedUsers.get(client.id);
    if (!entry) return;
    const timerKey = `channel:${payload.channelId}:${entry.userId}`;
    const timer = this.typingTimers.get(timerKey);
    if (timer) {
      clearTimeout(timer);
      this.typingTimers.delete(timerKey);
    }
  }

  @SubscribeMessage('mark-read')
  async handleMarkRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { channelId: string; lastReadAt: string },
  ) {
    const entry = this.connectedUsers.get(client.id);
    if (!entry) return;

    await this.prisma.channelMemberState.upsert({
      where: { channelId_userId: { channelId: payload.channelId, userId: entry.userId } },
      create: {
        channelId: payload.channelId,
        userId: entry.userId,
        lastReadAt: new Date(payload.lastReadAt),
      },
      update: { lastReadAt: new Date(payload.lastReadAt) },
    });
  }

  // ─── Direct Messages ──────────────────────────────────────────────────────

  @SubscribeMessage('join-dm')
  async handleJoinDm(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId: string },
  ) {
    const entry = this.connectedUsers.get(client.id);
    if (!entry) return;

    const convo = await this.prisma.communityDmConversation.findUnique({
      where: { id: payload.conversationId },
      select: { participant1Id: true, participant2Id: true },
    });

    if (
      !convo ||
      (convo.participant1Id !== entry.userId && convo.participant2Id !== entry.userId)
    ) {
      client.emit('error', { event: 'join-dm', message: 'Not a participant in this conversation' });
      return;
    }

    client.join(`dm:${payload.conversationId}`);
  }

  @SubscribeMessage('send-dm')
  async handleSendDm(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      conversationId: string;
      ciphertext: string;
      nonce: string;
      keyEpoch: number;
      messageType?: 'TEXT' | 'IMAGE';
      mediaKey?: string;
      mediaSizeBytes?: number;
    },
  ) {
    const entry = this.connectedUsers.get(client.id);
    if (!entry) return;

    if (!payload.conversationId || !payload.ciphertext || !payload.nonce) {
      client.emit('error', {
        event: 'send-dm',
        message: 'conversationId, ciphertext and nonce are required (E2EE)',
      });
      return;
    }

    // createMessage enforces the conversation is ACCEPTED and the sender is a participant.
    // The server only relays opaque ciphertext — it never sees plaintext.
    let message;
    try {
      message = await this.dmService.createMessage(payload.conversationId, entry.userId, {
        ciphertext: payload.ciphertext,
        nonce: payload.nonce,
        keyEpoch: payload.keyEpoch,
        messageType: payload.messageType as DmMessageType | undefined,
        mediaKey: payload.mediaKey,
        mediaSizeBytes: payload.mediaSizeBytes,
      });
    } catch (err) {
      client.emit('error', { event: 'send-dm', message: (err as Error).message });
      return;
    }

    const conversationId = payload.conversationId;
    this.server.to(`dm:${conversationId}`).emit('new-dm', { conversationId, message });

    // Also notify the other participant via their user room if not in the DM room
    const convo = await this.prisma.communityDmConversation.findUnique({
      where: { id: conversationId },
      select: { participant1Id: true, participant2Id: true },
    });
    if (convo) {
      const otherId =
        convo.participant1Id === entry.userId ? convo.participant2Id : convo.participant1Id;
      this.server.to(`user:${otherId}`).emit('new-dm', { conversationId, message });
    }
  }

  @SubscribeMessage('dm-typing-start')
  async handleDmTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId: string },
  ) {
    const entry = this.connectedUsers.get(client.id);
    if (!entry) return;

    client.to(`dm:${payload.conversationId}`).emit('dm-typing', {
      conversationId: payload.conversationId,
      userId: entry.userId,
    });

    const timerKey = `dm:${payload.conversationId}:${entry.userId}`;
    const existing = this.typingTimers.get(timerKey);
    if (existing) clearTimeout(existing);
    this.typingTimers.set(
      timerKey,
      setTimeout(() => this.typingTimers.delete(timerKey), TYPING_TIMEOUT_MS),
    );
  }

  @SubscribeMessage('dm-typing-stop')
  handleDmTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId: string },
  ) {
    const entry = this.connectedUsers.get(client.id);
    if (!entry) return;
    const timerKey = `dm:${payload.conversationId}:${entry.userId}`;
    const timer = this.typingTimers.get(timerKey);
    if (timer) {
      clearTimeout(timer);
      this.typingTimers.delete(timerKey);
    }
  }

  @SubscribeMessage('mark-dm-read')
  async handleMarkDmRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId: string },
  ) {
    const entry = this.connectedUsers.get(client.id);
    if (!entry) return;

    const now = new Date();
    await this.prisma.communityDmReadState.upsert({
      where: { conversationId_userId: { conversationId: payload.conversationId, userId: entry.userId } },
      create: {
        conversationId: payload.conversationId,
        userId: entry.userId,
        lastReadAt: now,
      },
      update: { lastReadAt: now },
    });

    this.server.to(`dm:${payload.conversationId}`).emit('dm-read', {
      conversationId: payload.conversationId,
      userId: entry.userId,
      lastReadAt: now.toISOString(),
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async verifyActiveMember(communityId: string, userId: string): Promise<boolean> {
    const member = await this.prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId, userId } },
      select: { status: true },
    });
    return member?.status === CommunityMemberStatus.ACTIVE;
  }

  emitToChannel(channelId: string, event: string, data: unknown): void {
    this.server.to(`channel:${channelId}`).emit(event, data);
  }

  emitToUser(userId: string, event: string, data: unknown): void {
    this.server.to(`user:${userId}`).emit(event, data);
  }
}
