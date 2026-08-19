import { Logger } from '@nestjs/common';
import { MessageBody, ConnectedSocket, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import * as firebaseAdmin from 'firebase-admin';
import { Namespace, Socket } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service';
import { getCorsOrigin } from '../../common/utils/cors-origin.util';

const TYPING_TIMEOUT_MS = 3000;

type TypingPayload = { interestId: string; senderType: 'HOST' | 'BRAND' | 'ADMIN' };

// Lightweight, presence-only gateway just for the "X is typing…" indicator on sponsorship
// (TriChat) threads — actual messages still go through the existing REST + polling flow.
@WebSocketGateway({
  namespace: '/sponsorship-chat',
  cors: {
    origin: getCorsOrigin(),
    credentials: true,
  },
})
export class SponsorshipChatGateway implements OnGatewayInit {
  @WebSocketServer() server: Namespace;

  private readonly logger = new Logger(SponsorshipChatGateway.name);
  private readonly typingTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly prisma: PrismaService) {}

  afterInit(namespace: Namespace) {
    // Runs as part of the handshake, before the client's "connect" event fires — unlike
    // handleConnection (which races against the client immediately emitting join-chat), this
    // guarantees socket.data.userId is set before ANY message from the client is handled.
    namespace.use((socket: Socket, next: (err?: Error) => void) => {
      const token = (socket.handshake.auth?.token ?? socket.handshake.query?.token) as string | undefined;
      if (!token) {
        next(new Error('No auth token'));
        return;
      }
      firebaseAdmin
        .auth()
        .verifyIdToken(token)
        .then((decoded) => this.prisma.user.findUnique({ where: { firebaseUid: decoded.uid }, select: { id: true } }))
        .then((user) => {
          if (!user) {
            next(new Error('User not found'));
            return;
          }
          socket.data.userId = user.id;
          next();
        })
        .catch((err) => {
          this.logger.warn(`Socket rejected: ${(err as Error).message}`);
          next(new Error('Auth failed'));
        });
    });
  }

  @SubscribeMessage('join-chat')
  handleJoinChat(@ConnectedSocket() client: Socket, @MessageBody() payload: { interestId: string }) {
    if (!client.data.userId || !payload?.interestId) return;
    client.join(`interest:${payload.interestId}`);
  }

  @SubscribeMessage('typing-start')
  handleTypingStart(@ConnectedSocket() client: Socket, @MessageBody() payload: TypingPayload) {
    if (!client.data.userId || !payload?.interestId) return;
    client.to(`interest:${payload.interestId}`).emit('typing', payload);

    const key = `${payload.interestId}:${client.data.userId}`;
    const existing = this.typingTimers.get(key);
    if (existing) clearTimeout(existing);
    // Auto-clears if the typer goes silent without an explicit typing-stop (closed tab, etc.).
    this.typingTimers.set(
      key,
      setTimeout(() => {
        this.typingTimers.delete(key);
        client.to(`interest:${payload.interestId}`).emit('typing-stopped', payload);
      }, TYPING_TIMEOUT_MS),
    );
  }

  @SubscribeMessage('typing-stop')
  handleTypingStop(@ConnectedSocket() client: Socket, @MessageBody() payload: TypingPayload) {
    if (!client.data.userId || !payload?.interestId) return;
    const key = `${payload.interestId}:${client.data.userId}`;
    const timer = this.typingTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.typingTimers.delete(key);
    }
    client.to(`interest:${payload.interestId}`).emit('typing-stopped', payload);
  }
}
