import { Module } from '@nestjs/common';
import { CommunitiesController } from './communities.controller';
import { CommunitiesAdminController } from './communities-admin.controller';
import { CommunityMembersController } from './community-members.controller';
import { CommunitiesService } from './communities.service';
import { CommunityMembersService } from './community-members.service';
import { StorageModule } from '../../common/storage/storage.module';
import { ConsentModule } from '../consent/consent.module';
import { CommunityChatModule } from '../community-chat/community-chat.module';
import { CommunityRoleGuard } from '../../common/guards/community-role.guard';

@Module({
  imports: [StorageModule, ConsentModule, CommunityChatModule],
  controllers: [CommunitiesAdminController, CommunitiesController, CommunityMembersController],
  providers: [CommunitiesService, CommunityMembersService, CommunityRoleGuard],
  exports: [CommunitiesService, CommunityMembersService],
})
export class CommunitiesModule {}
