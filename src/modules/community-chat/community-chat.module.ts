import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { CommunityChatAdminController } from './community-chat-admin.controller';
import { CommunityChatController } from './community-chat.controller';
import { CommunityChatGateway } from './community-chat.gateway';
import { CommunityChatService } from './community-chat.service';
import { CommunityChannelService } from './community-channel.service';
import { CommunityDmService } from './community-dm.service';
import { CommunityPresenceService } from './community-presence.service';
import { CommunityRoleGuard } from '../../common/guards/community-role.guard';

@Module({
  imports: [NotificationsModule],
  controllers: [CommunityChatController, CommunityChatAdminController],
  providers: [
    CommunityChatGateway,
    CommunityChatService,
    CommunityChannelService,
    CommunityDmService,
    CommunityPresenceService,
    CommunityRoleGuard,
  ],
  exports: [CommunityChatService, CommunityChannelService, CommunityPresenceService, CommunityDmService],
})
export class CommunityChatModule {}
