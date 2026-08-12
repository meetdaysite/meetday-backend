import { Logger, MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import configuration from './config/configuration';
import { validate } from './config/env.schema';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
// Paused until Fast2SMS DLT registration is approved — Google Sign-In is the sole signup/login
// method in the meantime. Uncomment to re-enable phone-OTP send/verify endpoints.
// import { PhoneOtpModule } from './modules/phone-otp/phone-otp.module';
import { UsersModule } from './modules/users/users.module';
import { HostsModule } from './modules/hosts/hosts.module';
import { BrandsModule } from './modules/brands/brands.module';
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
import { AuditLogModule } from './modules/audit-log/audit-log.module';
import { ConsentModule } from './modules/consent/consent.module';
import { InterestsModule } from './modules/interests/interests.module';
import { GraphModule } from './modules/graph/graph.module';
import { SupportTicketModule } from './modules/support-ticket/support-ticket.module';
import { PayoutsModule } from './modules/payouts/payouts.module';
import { RefundsModule } from './modules/refunds/refunds.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { SponsorshipModule } from './modules/sponsorship/sponsorship.module';
import { FirebaseAuthGuard } from './common/guards/firebase-auth.guard';
import { IpRateLimitMiddleware } from './common/middleware/ip-rate-limit.middleware';
import { RegistrationVelocityMiddleware } from './common/middleware/registration-velocity.middleware';
import { HealthModule } from './common/health/health.module';
import { MailModule } from './common/mail/mail.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { RedisModule } from './common/redis/redis.module';
import { StorageModule } from './common/storage/storage.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AdminActionAlertInterceptor } from './common/interceptors/admin-action-alert.interceptor';

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
    // PhoneOtpModule, // paused until Fast2SMS DLT registration is approved
    UsersModule,
    HostsModule,
    BrandsModule,
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
    SupportTicketModule,
    PayoutsModule,
    RefundsModule,
    MaintenanceModule,
    SponsorshipModule,
    BullModule.registerQueue({ name: 'mail' }),
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
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AdminActionAlertInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(IpRateLimitMiddleware).forRoutes('*');
    consumer
      .apply(RegistrationVelocityMiddleware)
      .forRoutes({ path: 'api/v1/auth/register', method: RequestMethod.POST });
  }
}
