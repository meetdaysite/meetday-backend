import { Module } from '@nestjs/common';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { CampaignCopilotService } from './campaign-copilot.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { DocumentExtractionModule } from '../../common/document-extraction/document-extraction.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TeamAccessModule } from '../../common/team-access/team-access.module';

@Module({
  imports: [DocumentExtractionModule, NotificationsModule, TeamAccessModule],
  controllers: [CampaignsController],
  providers: [CampaignsService, CampaignCopilotService, RolesGuard],
  exports: [CampaignsService],
})
export class CampaignsModule {}
