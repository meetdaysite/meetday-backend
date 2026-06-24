import { Module } from '@nestjs/common';
import { StorageModule } from '../../common/storage/storage.module';
import { CommunityRoleGuard } from '../../common/guards/community-role.guard';
import { CommunityFeedController } from './community-feed.controller';
import { CommunityFeedService } from './community-feed.service';

@Module({
  imports: [StorageModule],
  controllers: [CommunityFeedController],
  providers: [CommunityFeedService, CommunityRoleGuard],
  exports: [CommunityFeedService],
})
export class CommunityFeedModule {}
