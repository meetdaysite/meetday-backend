import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import * as firebaseAdmin from 'firebase-admin';
import { Redis } from 'ioredis';
import { Namespace, Socket } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service';
import { getCorsOrigin } from '../../common/utils/cors-origin.util';

@WebSocketGateway({
  namespace: '/notifications',
  cors: {
    origin: getCorsOrigin(),
    credentials: true,
  },
})
export class NotificationsGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer() server: Namespace;

  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  afterInit(namespace: Namespace) {
    const pubClient = new Redis({
      host: this.configService.get<string>('redis.host'),
      port: this.configService.get<number>('redis.port'),
    });
    const subClient = pubClient.duplicate();
    // adapter() lives on the root Server, not the Namespace
    namespace.server.adapter(createAdapter(pubClient, subClient));
    this.logger.log('WebSocket Redis adapter initialized');
  }

  async handleConnection(client: Socket) {
    const token = (client.handshake.auth?.token ?? client.handshake.query?.token) as string | undefined;

    if (!token) {
      this.logger.warn(`Socket rejected: no token in handshake socketId=${client.id}`);
      client.disconnect();
      return;
    }

    let userId: string;

    try {
      const decoded = await firebaseAdmin.auth().verifyIdToken(token);

      const user = await this.prisma.user.findUnique({
        where: { firebaseUid: decoded.uid },
        select: { id: true },
      });

      if (!user) {
        this.logger.warn(`Socket rejected: no DB user for firebaseUid=${decoded.uid}`);
        client.disconnect();
        return;
      }

      userId = user.id;
      // Join the room by DB user ID — must match the userId passed to sendToUser()
      client.join(userId);
      this.logger.log(`Socket connected: userId=${userId} socketId=${client.id}`);
    } catch (err) {
      this.logger.warn(`Socket rejected: token verification failed — ${(err as Error).message}`);
      client.disconnect();
      return;
    }

    // Best-effort: signal the client with their unread count so they can refresh if they
    // missed notifications while disconnected. Failure here must NOT disconnect the user.
    try {
      const unreadCount = await this.prisma.notification.count({
        where: { userId, isRead: false },
      });
      client.emit('unread_count', { count: unreadCount });
    } catch (err) {
      this.logger.warn(`Failed to emit unread_count on connect: socketId=${client.id} — ${(err as Error).message}`);
    }
  }

  sendToUser(userId: string, event: string, data: unknown): void {
    this.server.to(userId).emit(event, data);
    this.logger.log(`WS emit: event=${event} userId=${userId}`);
  }

  // Reuses the per-user room every connected client already joins (see handleConnection) —
  // a room with at least one live socket means that user currently has the app open.
  async getOnlineUserIds(userIds: string[]): Promise<Set<string>> {
    const online = await Promise.all(
      userIds.map(async (id) => {
        try {
          const sockets = await this.server.in(id).fetchSockets();
          return sockets.length > 0 ? id : null;
        } catch (err) {
          this.logger.warn(`fetchSockets failed for userId=${id} — ${(err as Error).message}`);
          return null;
        }
      }),
    );
    return new Set(online.filter((id): id is string => id !== null));
  }
}
