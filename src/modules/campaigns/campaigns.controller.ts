import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';

@ApiTags('Campaigns')
@ApiBearerAuth('firebase-token')
@UseGuards(RolesGuard)
@Roles('BRAND')
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new campaign brief' })
  @ApiCreatedResponse({ description: 'Campaign brief created.' })
  createCampaign(
    @GetUser('id') userId: string,
    @Body() dto: CreateCampaignDto,
  ) {
    return this.campaignsService.createCampaign(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: "List brand's own campaigns" })
  @ApiOkResponse({ description: 'List of campaigns.' })
  getCampaigns(@GetUser('id') userId: string) {
    return this.campaignsService.getCampaigns(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get details of a campaign' })
  @ApiOkResponse({ description: 'Campaign details.' })
  getCampaign(
    @GetUser('id') userId: string,
    @Param('id', ParseUUIDPipe) campaignId: string,
  ) {
    return this.campaignsService.getCampaign(userId, campaignId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an existing campaign' })
  @ApiOkResponse({ description: 'Updated campaign details.' })
  updateCampaign(
    @GetUser('id') userId: string,
    @Param('id', ParseUUIDPipe) campaignId: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.campaignsService.updateCampaign(userId, campaignId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a campaign brief' })
  @ApiOkResponse({ description: 'Campaign deleted.' })
  deleteCampaign(
    @GetUser('id') userId: string,
    @Param('id', ParseUUIDPipe) campaignId: string,
  ) {
    return this.campaignsService.deleteCampaign(userId, campaignId);
  }
}
