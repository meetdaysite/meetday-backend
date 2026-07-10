import { Module } from '@nestjs/common';
import { StorageModule } from '../../common/storage/storage.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({
  imports: [StorageModule, NotificationsModule],
  controllers: [ReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
