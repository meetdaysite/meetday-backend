import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { SponsorshipController } from './sponsorship.controller';
import { SponsorshipService } from './sponsorship.service';
import { SponsorshipInvoicePdfService } from './sponsorship-invoice-pdf.service';
import { SponsorshipReportPdfService } from './sponsorship-report-pdf.service';
import { ProposalCopilotService } from './proposal-copilot.service';
import { UnreadChatMailProcessor } from './processors/unread-chat-mail.processor';
import { SponsorshipChatGateway } from './sponsorship-chat.gateway';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageModule } from '../../common/storage/storage.module';
import { DocumentExtractionModule } from '../../common/document-extraction/document-extraction.module';

@Module({
  imports: [NotificationsModule, StorageModule, DocumentExtractionModule, BullModule.registerQueue({ name: 'mail' })],
  controllers: [SponsorshipController],
  providers: [SponsorshipService, SponsorshipInvoicePdfService, SponsorshipReportPdfService, ProposalCopilotService, UnreadChatMailProcessor, SponsorshipChatGateway],
  exports: [SponsorshipService],
})
export class SponsorshipModule {}
