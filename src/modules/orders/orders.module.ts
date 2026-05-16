import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';
import { NotificationsModule } from '../notifications/notifications.module';
import { MailModule } from '../../common/mail/mail.module';
import { StorageModule } from '../../common/storage/storage.module';
import { EventsModule } from '../events/events.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { TicketPdfService } from './ticket-pdf.service';
import { OrderMailProcessor } from './processors/order-mail.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'mail' }),
    ScheduleModule.forRoot(),
    NotificationsModule,
    MailModule,
    StorageModule,
    EventsModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService, TicketPdfService, OrderMailProcessor],
})
export class OrdersModule {}
