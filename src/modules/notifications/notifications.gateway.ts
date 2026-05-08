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
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  namespace: '/notifications',
  cors: {
    origin: process.env.NODE_ENV === 'production' ? process.env.FRONTEND_URL : true,
    credentials: true,
  },
})
export class NotificationsGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer() server: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(private readonly configService: ConfigService) {}

  afterInit(server: Server) {
    const pubClient = new Redis({
      host: this.configService.get<string>('redis.host'),
      port: this.configService.get<number>('redis.port'),
    });
    const subClient = pubClient.duplicate();
    server.adapter(createAdapter(pubClient, subClient));
    this.logger.log('WebSocket Redis adapter initialized');
  }

  async handleConnection(client: Socket) {
    const token = client.handshake.auth?.token as string | undefined;

    if (!token) {
      client.disconnect();
      return;
    }

    try {
      const decoded = await firebaseAdmin.auth().verifyIdToken(token);
      client.join(decoded.uid);
      this.logger.log(`Socket connected: user=${decoded.uid} socketId=${client.id}`);
    } catch {
      client.disconnect();
    }
  }

  sendToUser(userId: string, event: string, data: unknown): void {
    this.server.to(userId).emit(event, data);
  }
}
