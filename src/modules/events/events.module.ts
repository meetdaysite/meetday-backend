import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { CheckInModule } from '../check-in/check-in.module';

@Module({
  imports: [NotificationsModule, ReviewsModule, CheckInModule],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
