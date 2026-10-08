import { ForbiddenException } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { TeamAccessService } from '../../common/team-access/team-access.service';

describe('CampaignsService.markInterest', () => {
  const prisma = {
    spaceProfile: { findUnique: jest.fn() },
    hostProfile: { findUnique: jest.fn() },
    brandProfile: { findUnique: jest.fn() },
    campaign: { findUnique: jest.fn(), create: jest.fn() },
    sponsorshipInterest: { findFirst: jest.fn(), create: jest.fn() },
  };
  const notifications = { create: jest.fn().mockResolvedValue(undefined) };
  const teamAccess = { resolveHostProfileId: jest.fn() };
  let service: CampaignsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CampaignsService(
      prisma as unknown as PrismaService,
      {} as StorageService,
      notifications as unknown as NotificationsService,
      teamAccess as unknown as TeamAccessService,
    );
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'campaign-1',
      name: 'Summer campaign',
      status: 'PUBLISHED',
      brandProfileId: 'brand-1',
      brandProfile: { userId: 'brand-user' },
    });
    prisma.sponsorshipInterest.findFirst.mockResolvedValue(null);
    prisma.sponsorshipInterest.create.mockResolvedValue({ id: 'interest-1' });
  });

  it('creates an interest owned by the approved Hub profile', async () => {
    prisma.spaceProfile.findUnique.mockResolvedValue({
      id: 'space-1',
      businessName: 'Central Hub',
      communityProfile: { name: 'Central Hub', approvalStatus: 'APPROVED' },
    });

    const result = await service.markInterest('space-user', 'campaign-1', 'SPACE');

    expect(prisma.sponsorshipInterest.findFirst).toHaveBeenCalledWith({
      where: { campaignId: 'campaign-1', spaceProfileId: 'space-1' },
    });
    expect(prisma.sponsorshipInterest.create).toHaveBeenCalledWith({
      data: {
        campaignId: 'campaign-1',
        spaceProfileId: 'space-1',
        brandProfileId: 'brand-1',
        chatStatus: 'REQUESTED',
      },
    });
    expect(notifications.create).toHaveBeenCalledWith(
      'brand-user',
      'space_interested_in_campaign',
      'Central Hub is interested!',
      expect.stringContaining('Central Hub'),
      { campaignId: 'campaign-1', sponsorshipInterestId: 'interest-1' },
    );
    expect(result.interestId).toBe('interest-1');
  });

  it('requires an approved Hub profile before expressing interest', async () => {
    prisma.spaceProfile.findUnique.mockResolvedValue({
      id: 'space-1',
      businessName: 'Pending Hub',
      communityProfile: { name: 'Pending Hub', approvalStatus: 'PENDING' },
    });

    await expect(service.markInterest('space-user', 'campaign-1', 'SPACE')).rejects.toThrow(ForbiddenException);
    expect(prisma.sponsorshipInterest.create).not.toHaveBeenCalled();
  });

  it('keeps existing Community campaign interest ownership unchanged', async () => {
    teamAccess.resolveHostProfileId.mockResolvedValue('host-1');
    prisma.hostProfile.findUnique.mockResolvedValue({
      id: 'host-1',
      displayName: 'City Community',
      approvalStatus: 'APPROVED',
      communityProfile: { name: 'City Community' },
    });

    const result = await service.markInterest('host-user', 'campaign-1');

    expect(prisma.sponsorshipInterest.create).toHaveBeenCalledWith({
      data: {
        campaignId: 'campaign-1',
        hostProfileId: 'host-1',
        brandProfileId: 'brand-1',
        chatStatus: 'REQUESTED',
      },
    });
    expect(result.interestId).toBe('interest-1');
  });
});

describe('CampaignsService.createCampaign', () => {
  const prisma = {
    brandProfile: { findUnique: jest.fn() },
    campaign: { create: jest.fn() },
  };
  const notifications = { create: jest.fn().mockResolvedValue(undefined) };
  const teamAccess = { resolveBrandProfileId: jest.fn() };
  let service: CampaignsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CampaignsService(
      prisma as unknown as PrismaService,
      {} as StorageService,
      notifications as unknown as NotificationsService,
      teamAccess as unknown as TeamAccessService,
    );
    teamAccess.resolveBrandProfileId.mockResolvedValue('brand-1');
    prisma.brandProfile.findUnique.mockResolvedValue({ id: 'brand-1', approvalStatus: 'APPROVED' });
    prisma.campaign.create.mockResolvedValue({ id: 'campaign-1', status: 'DRAFT' });
  });

  it('persists a Brand campaign brief through the Brand profile', async () => {
    const payload = {
      name: 'Summer sampling',
      goal: 'Product Sampling',
      locations: ['Delhi'],
      audience: ['Founders'],
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      offerType: 'CASH',
      budgetAmount: 50000,
      budgetCurrency: 'INR',
      description: 'Meet the community in person.',
      status: 'DRAFT' as const,
    };

    const result = await service.createCampaign('brand-user', payload);

    expect(teamAccess.resolveBrandProfileId).toHaveBeenCalledWith('brand-user');
    expect(prisma.campaign.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        brandProfileId: 'brand-1',
        name: 'Summer sampling',
        locations: ['Delhi'],
        audience: ['Founders'],
        budgetAmount: 50000,
        status: 'DRAFT',
      }),
    });
    expect(result.id).toBe('campaign-1');
  });

  it('requires an approved Brand profile before creating a campaign', async () => {
    prisma.brandProfile.findUnique.mockResolvedValue({ id: 'brand-1', approvalStatus: 'PENDING' });

    await expect(service.createCampaign('brand-user', { name: 'Draft' })).rejects.toThrow(ForbiddenException);
    expect(prisma.campaign.create).not.toHaveBeenCalled();
  });
});
