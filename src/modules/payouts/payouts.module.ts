import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { PayoutsService } from './payouts.service';
import { PayoutsController } from './payouts.controller';
import { AdminPayoutsController } from './admin-payouts.controller';
import { PayoutsCron } from './payouts.cron';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'mail' }),
    ConfigModule,
    NotificationsModule,
    AuditLogModule,
  ],
  controllers: [PayoutsController, AdminPayoutsController],
  providers: [PayoutsService, PayoutsCron],
  exports: [PayoutsService],
})
export class PayoutsModule {}
