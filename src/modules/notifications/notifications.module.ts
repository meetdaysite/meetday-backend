import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { FcmService } from './fcm.service';

@Module({
  imports: [ConfigModule],
  controllers: [NotificationsController],
  providers: [NotificationsGateway, NotificationsService, FcmService],
  exports: [NotificationsService, NotificationsGateway, FcmService],
})
export class NotificationsModule {}
