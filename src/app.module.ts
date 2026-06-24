import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import configuration from './config/configuration';
import { validate } from './config/env.schema';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { HostsModule } from './modules/hosts/hosts.module';
import { EventsModule } from './modules/events/events.module';
import { CommunitiesModule } from './modules/communities/communities.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { AdminModule } from './modules/admin/admin.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { AttendeeModule } from './modules/attendee/attendee.module';
import { OrdersModule } from './modules/orders/orders.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { CheckInModule } from './modules/check-in/check-in.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { CommunityChatModule } from './modules/community-chat/community-chat.module';
import { CommunityAnnouncementsModule } from './modules/community-announcements/community-announcements.module';
import { CommunityFeedModule } from './modules/community-feed/community-feed.module';
import { E2eeModule } from './modules/e2ee/e2ee.module';
import { AuditLogModule } from './modules/audit-log/audit-log.module';
import { ConsentModule } from './modules/consent/consent.module';
import { InterestsModule } from './modules/interests/interests.module';
import { GraphModule } from './modules/graph/graph.module';
import { FirebaseAuthGuard } from './common/guards/firebase-auth.guard';
import { HealthModule } from './common/health/health.module';
import { MailModule } from './common/mail/mail.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { RedisModule } from './common/redis/redis.module';
import { StorageModule } from './common/storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: '.env',
      validate,
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get<string>('redis.host'),
          port: configService.get<number>('redis.port'),
        },
      }),
      inject: [ConfigService],
    }),
    RedisModule,
    StorageModule,
    PrismaModule,
    MailModule,
    CryptoModule,
    AuthModule,
    UsersModule,
    HostsModule,
    EventsModule,
    TicketsModule,
    PaymentsModule,
    AdminModule,
    CategoriesModule,
    AttendeeModule,
    OrdersModule,
    ReviewsModule,
    CheckInModule,
    HealthModule,
    NotificationsModule,
    AuditLogModule,
    ConsentModule,
    InterestsModule,
    GraphModule,
    CommunitiesModule,
    CommunityChatModule,
    CommunityAnnouncementsModule,
    CommunityFeedModule,
    E2eeModule,
  ],
  providers: [
    Logger,
    {
      provide: APP_GUARD,
      useClass: FirebaseAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
