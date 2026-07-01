import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { StorageModule } from '../../common/storage/storage.module';
import { CommunityRoleGuard } from '../../common/guards/community-role.guard';
import { CommunityAnnouncementsAdminController } from './community-announcements-admin.controller';
import { CommunityAnnouncementsController } from './community-announcements.controller';
import { CommunityAnnouncementsHostController } from './community-announcements-host.controller';
import { CommunityAnnouncementsProcessor } from './community-announcements.processor';
import { CommunityAnnouncementsService } from './community-announcements.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'community-announcements' }),
    StorageModule,
    NotificationsModule,
  ],
  controllers: [CommunityAnnouncementsController, CommunityAnnouncementsAdminController, CommunityAnnouncementsHostController],
  providers: [
    CommunityAnnouncementsService,
    CommunityAnnouncementsProcessor,
    CommunityRoleGuard,
  ],
  exports: [CommunityAnnouncementsService],
})
export class CommunityAnnouncementsModule {}
