import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';

@Injectable()
export class CampaignsService {
  constructor(private readonly prisma: PrismaService) {}

  private async getBrandProfile(userId: string) {
    const brandProfile = await this.prisma.brandProfile.findUnique({
      where: { userId },
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
    return this.prisma.campaign.findMany({
      where: { status: 'PUBLISHED' },
      include: {
        brandProfile: {
          select: {
            id: true,
            brandName: true,
            user: { select: { firstName: true, lastName: true, email: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPublishedCampaign(campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        brandProfile: {
          select: {
            id: true,
            brandName: true,
            user: { select: { firstName: true, lastName: true, email: true } },
          },
        },
      },
    });
    if (!campaign || campaign.status !== 'PUBLISHED') {
      throw new NotFoundException('Campaign not found');
    }
    return campaign;
  }
}
