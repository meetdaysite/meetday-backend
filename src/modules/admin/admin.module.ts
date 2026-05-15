import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { InterestsModule } from '../interests/interests.module';

@Module({
  imports: [BullModule.registerQueue({ name: 'mail' }), ConfigModule, NotificationsModule, ReviewsModule, InterestsModule],
  controllers: [AdminController],
  providers: [AdminService, RolesGuard],
  exports: [AdminService],
})
export class AdminModule {}
