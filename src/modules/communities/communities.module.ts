import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { CommunitiesController } from './communities.controller';
import { CommunitiesAdminController } from './communities-admin.controller';
import { CommunityMembersController } from './community-members.controller';
import { CommunityMembersAdminController } from './community-members-admin.controller';
import { CommunitiesService } from './communities.service';
import { CommunityMembersService } from './community-members.service';
import { CommunityMembersAdminService } from './community-members-admin.service';
import { CommunityOverviewService } from './community-overview.service';
import { CommunityAnalyticsService } from './community-analytics.service';
import { StorageModule } from '../../common/storage/storage.module';
import { ConsentModule } from '../consent/consent.module';
import { CommunityChatModule } from '../community-chat/community-chat.module';
import { CommunityRoleGuard } from '../../common/guards/community-role.guard';

@Module({
  imports: [StorageModule, ConsentModule, CommunityChatModule, MulterModule.register()],
  controllers: [CommunitiesAdminController, CommunitiesController, CommunityMembersController, CommunityMembersAdminController],
  providers: [CommunitiesService, CommunityMembersService, CommunityMembersAdminService, CommunityOverviewService, CommunityAnalyticsService, CommunityRoleGuard],
  exports: [CommunitiesService, CommunityMembersService],
})
export class CommunitiesModule {}
