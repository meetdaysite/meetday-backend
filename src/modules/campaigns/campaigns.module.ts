import { Module } from '@nestjs/common';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  controllers: [CampaignsController],
  providers: [CampaignsService, RolesGuard],
  exports: [CampaignsService],
})
export class CampaignsModule {}
