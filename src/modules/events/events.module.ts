import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { EventsVibeService } from './events-vibe.service';
import { CopilotService } from './copilot.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { CheckInModule } from '../check-in/check-in.module';
import { GraphModule } from '../graph/graph.module';
import { StorageModule } from '../../common/storage/storage.module';

@Module({
  imports: [NotificationsModule, ReviewsModule, CheckInModule, GraphModule, StorageModule],
  controllers: [EventsController],
  providers: [EventsService, EventsVibeService, CopilotService],
  exports: [EventsService, EventsVibeService],
})
export class EventsModule {}
