import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageModule } from '../../common/storage/storage.module';
import { CommunityChatAdminController } from './community-chat-admin.controller';
import { CommunityChatController } from './community-chat.controller';
import { CommunityChatGateway } from './community-chat.gateway';
import { CommunityChatService } from './community-chat.service';
import { CommunityChatModerationService } from './community-chat-moderation.service';
import { CommunityChannelService } from './community-channel.service';
import { CommunityDmService } from './community-dm.service';
import { CommunityPresenceService } from './community-presence.service';
import { CommunityRoleGuard } from '../../common/guards/community-role.guard';

@Module({
  imports: [NotificationsModule, StorageModule],
  controllers: [CommunityChatController, CommunityChatAdminController],
  providers: [
    CommunityChatGateway,
    CommunityChatService,
    CommunityChatModerationService,
    CommunityChannelService,
    CommunityDmService,
    CommunityPresenceService,
    CommunityRoleGuard,
  ],
  exports: [CommunityChatService, CommunityChatModerationService, CommunityChannelService, CommunityPresenceService, CommunityDmService],
})
export class CommunityChatModule {}
