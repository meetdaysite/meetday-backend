import { Module } from '@nestjs/common';
import { StorageModule } from '../../common/storage/storage.module';
import { CommunityRoleGuard } from '../../common/guards/community-role.guard';
import { CommunityFeedController } from './community-feed.controller';
import { CommunityFeedAdminController } from './community-feed-admin.controller';
import { CommunityFeedService } from './community-feed.service';
import { CommunityFeedAdminService } from './community-feed-admin.service';

@Module({
  imports: [StorageModule],
  controllers: [CommunityFeedController, CommunityFeedAdminController],
  providers: [CommunityFeedService, CommunityFeedAdminService, CommunityRoleGuard],
  exports: [CommunityFeedService],
})
export class CommunityFeedModule {}
