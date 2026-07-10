import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { MailModule } from '../../common/mail/mail.module';
import { RefundsService } from './refunds.service';
import { RefundsProcessor } from './refunds.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'refund-processing' }),
    ConfigModule,
    NotificationsModule,
    AuditLogModule,
    MailModule,
  ],
  providers: [RefundsService, RefundsProcessor],
  exports: [RefundsService],
})
export class RefundsModule {}
