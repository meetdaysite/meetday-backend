import { OmitType } from '@nestjs/swagger';
import { CreateCampaignDto } from '../../campaigns/dto/create-campaign.dto';

export class UpdateAdminCampaignDto extends OmitType(CreateCampaignDto, ['status'] as const) {}
