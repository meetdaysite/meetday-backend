import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { StorageService } from '../../common/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TeamAccessService } from '../../common/team-access/team-access.service';

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly notificationsService: NotificationsService,
    private readonly teamAccessService: TeamAccessService,
  ) {}

  private async getBrandProfile(userId: string) {
    const brandProfileId = await this.teamAccessService.resolveBrandProfileId(userId);
    const brandProfile = await this.prisma.brandProfile.findUnique({
      where: { id: brandProfileId },
    });
    if (!brandProfile) {
      throw new NotFoundException('Brand profile not found');
    }
    return brandProfile;
  }

  async createCampaign(userId: string, dto: CreateCampaignDto) {
    const brandProfile = await this.getBrandProfile(userId);
    
    if (brandProfile.approvalStatus !== 'APPROVED') {
      throw new ForbiddenException('Your brand profile must be approved by an admin to create a campaign.');
    }

    return this.prisma.campaign.create({
      data: {
        brandProfileId: brandProfile.id,
        name: dto.name || 'Untitled Campaign',
        goal: dto.goal || '',
        locations: dto.locations || [],
        audience: dto.audience || [],
        startDate: dto.startDate ? new Date(dto.startDate) : new Date(),
        endDate: dto.endDate ? new Date(dto.endDate) : new Date(),
        offerType: dto.offerType || 'CASH',
        budgetAmount: dto.budgetAmount || 0,
        budgetCurrency: dto.budgetCurrency || 'INR',
        barterElements: dto.barterElements || null,
        description: dto.description || null,
        status: dto.status || 'DRAFT',
      },
    });
  }

  async getCampaigns(userId: string) {
    const brandProfile = await this.getBrandProfile(userId);
    return this.prisma.campaign.findMany({
      where: { brandProfileId: brandProfile.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getCampaign(userId: string, campaignId: string) {
    const brandProfile = await this.getBrandProfile(userId);
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign || campaign.brandProfileId !== brandProfile.id) {
      throw new NotFoundException('Campaign not found');
    }
    return campaign;
  }

  async updateCampaign(userId: string, campaignId: string, dto: UpdateCampaignDto) {
    const brandProfile = await this.getBrandProfile(userId);
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign || campaign.brandProfileId !== brandProfile.id) {
      throw new NotFoundException('Campaign not found');
    }

    return this.prisma.campaign.update({
      where: { id: campaignId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.goal !== undefined && { goal: dto.goal }),
        ...(dto.locations !== undefined && { locations: dto.locations }),
        ...(dto.audience !== undefined && { audience: dto.audience }),
        ...(dto.startDate !== undefined && { startDate: dto.startDate ? new Date(dto.startDate) : undefined }),
        ...(dto.endDate !== undefined && { endDate: dto.endDate ? new Date(dto.endDate) : undefined }),
        ...(dto.offerType !== undefined && { offerType: dto.offerType }),
        ...(dto.budgetAmount !== undefined && { budgetAmount: dto.budgetAmount }),
        ...(dto.budgetCurrency !== undefined && { budgetCurrency: dto.budgetCurrency }),
        ...(dto.barterElements !== undefined && { barterElements: dto.barterElements }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });
  }

  async deleteCampaign(userId: string, campaignId: string) {
    const brandProfile = await this.getBrandProfile(userId);
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign || campaign.brandProfileId !== brandProfile.id) {
      throw new NotFoundException('Campaign not found');
    }

    await this.prisma.campaign.delete({
      where: { id: campaignId },
    });
    return { success: true };
  }

  async getPublishedCampaigns() {
    const campaigns = await this.prisma.campaign.findMany({
      where: { status: 'PUBLISHED' },
      include: {
        brandProfile: {
          select: {
            id: true,
            brandName: true,
            logoKey: true,
            user: { select: { firstName: true, lastName: true, email: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(
      campaigns.map(async (c) => {
        if (c.brandProfile) {
          const logoUrl = c.brandProfile.logoKey
            ? await this.storageService.getPresignedDownloadUrl(c.brandProfile.logoKey)
            : null;
          return {
            ...c,
            brandProfile: {
              ...c.brandProfile,
              logoUrl,
            },
          };
        }
        return c;
      }),
    );
  }

  async getPublishedCampaign(campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        brandProfile: {
          select: {
            id: true,
            brandName: true,
            logoKey: true,
            user: { select: { firstName: true, lastName: true, email: true } },
          },
        },
      },
    });
    if (!campaign || campaign.status !== 'PUBLISHED') {
      throw new NotFoundException('Campaign not found');
    }
    if (campaign.brandProfile) {
      const logoUrl = campaign.brandProfile.logoKey
        ? await this.storageService.getPresignedDownloadUrl(campaign.brandProfile.logoKey)
        : null;
      return {
        ...campaign,
        brandProfile: {
          ...campaign.brandProfile,
          logoUrl,
        },
      };
    }
    return campaign;
  }

  async markInterest(userId: string, campaignId: string) {
    const hostProfileId = await this.teamAccessService.resolveHostProfileId(userId);
    const hostProfile = await this.prisma.hostProfile.findUnique({
      where: { id: hostProfileId },
      include: { communityProfile: true },
    });
    if (!hostProfile) {
      throw new NotFoundException('Host profile not found');
    }
    if (hostProfile.approvalStatus !== 'APPROVED') {
      throw new ForbiddenException('Your community profile must be approved by an admin to express interest in a campaign.');
    }

    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { brandProfile: { select: { userId: true } } },
    });
    if (!campaign || campaign.status !== 'PUBLISHED') {
      throw new NotFoundException('Published campaign not found');
    }

    const existingInterest = await this.prisma.sponsorshipInterest.findFirst({
      where: {
        campaignId,
        hostProfileId: hostProfile.id,
      },
    });

    if (existingInterest) {
      return { message: 'Interest already expressed', alreadyInterested: true };
    }

    const interest = await this.prisma.sponsorshipInterest.create({
      data: {
        campaignId,
        hostProfileId: hostProfile.id,
        brandProfileId: campaign.brandProfileId,
        chatStatus: 'REQUESTED',
      },
    });

    const communityName = hostProfile.communityProfile?.name ?? hostProfile.displayName ?? 'A community';

    // Notify the Brand of host interest in their campaign
    void this.notificationsService
      .create(
        campaign.brandProfile.userId,
        'host_interested_in_campaign',
        `${communityName} is interested!`,
        `This community is interested in your campaign: "${campaign.name}". Check your campaign requests.`,
        { campaignId, sponsorshipInterestId: interest.id },
      )
      .catch((err) => this.logger.error('Failed to notify brand of host interest', err));

    // Confirm to the host that interest has been sent
    void this.notificationsService
      .create(
        userId,
        'host_interest_confirmed',
        'Interest sent!',
        'The brand has been notified of your interest.',
        { campaignId, sponsorshipInterestId: interest.id },
      )
      .catch((err) => this.logger.error('Failed to notify host of confirmed interest', err));

    return { message: 'Interest expressed successfully', alreadyInterested: false, interestId: interest.id };
  }
}
