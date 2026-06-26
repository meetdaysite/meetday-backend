import { Module } from '@nestjs/common';
import { CommunitiesController } from './communities.controller';
import { CommunitiesAdminController } from './communities-admin.controller';
import { CommunityMembersController } from './community-members.controller';
import { CommunitiesService } from './communities.service';
import { CommunityMembersService } from './community-members.service';
import { CommunityOverviewService } from './community-overview.service';
import { CommunityAnalyticsService } from './community-analytics.service';
import { StorageModule } from '../../common/storage/storage.module';
import { ConsentModule } from '../consent/consent.module';
import { CommunityChatModule } from '../community-chat/community-chat.module';
import { CommunityRoleGuard } from '../../common/guards/community-role.guard';

@Module({
  imports: [StorageModule, ConsentModule, CommunityChatModule],
  controllers: [CommunitiesAdminController, CommunitiesController, CommunityMembersController],
  providers: [CommunitiesService, CommunityMembersService, CommunityOverviewService, CommunityAnalyticsService, CommunityRoleGuard],
  exports: [CommunitiesService, CommunityMembersService],
})
export class CommunitiesModule {}
