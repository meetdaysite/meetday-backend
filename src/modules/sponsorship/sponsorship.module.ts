import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { SponsorshipController } from './sponsorship.controller';
import { SponsorshipService } from './sponsorship.service';
import { ProposalCopilotService } from './proposal-copilot.service';
import { UnreadChatMailProcessor } from './processors/unread-chat-mail.processor';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageModule } from '../../common/storage/storage.module';

@Module({
  imports: [NotificationsModule, StorageModule, BullModule.registerQueue({ name: 'mail' })],
  controllers: [SponsorshipController],
  providers: [SponsorshipService, ProposalCopilotService, UnreadChatMailProcessor],
  exports: [SponsorshipService],
})
export class SponsorshipModule {}
