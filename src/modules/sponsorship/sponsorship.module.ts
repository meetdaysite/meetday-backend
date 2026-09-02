import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { SponsorshipController } from './sponsorship.controller';
import { SponsorshipService } from './sponsorship.service';
import { SponsorshipInvoicePdfService } from './sponsorship-invoice-pdf.service';
import { SponsorshipReportPdfService } from './sponsorship-report-pdf.service';
import { ProposalPdfGeneratorService } from './proposal-pdf-generator.service';
import { ProposalCopilotService } from './proposal-copilot.service';
import { UnreadChatMailProcessor } from './processors/unread-chat-mail.processor';
import { SponsorshipChatGateway } from './sponsorship-chat.gateway';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageModule } from '../../common/storage/storage.module';
import { DocumentExtractionModule } from '../../common/document-extraction/document-extraction.module';
import { TeamAccessModule } from '../../common/team-access/team-access.module';

@Module({
  imports: [NotificationsModule, StorageModule, DocumentExtractionModule, BullModule.registerQueue({ name: 'mail' }), TeamAccessModule],
  controllers: [SponsorshipController],
  providers: [SponsorshipService, SponsorshipInvoicePdfService, SponsorshipReportPdfService, ProposalPdfGeneratorService, ProposalCopilotService, UnreadChatMailProcessor, SponsorshipChatGateway],
  exports: [SponsorshipService, SponsorshipInvoicePdfService, SponsorshipReportPdfService],
})
export class SponsorshipModule {}
