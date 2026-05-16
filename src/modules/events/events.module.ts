import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { EventsVibeService } from './events-vibe.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { CheckInModule } from '../check-in/check-in.module';
import { StorageModule } from '../../common/storage/storage.module';

@Module({
  imports: [NotificationsModule, ReviewsModule, CheckInModule, StorageModule],
  controllers: [EventsController],
  providers: [EventsService, EventsVibeService],
  exports: [EventsService, EventsVibeService],
})
export class EventsModule {}
