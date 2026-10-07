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
    campaign: { findUnique: jest.fn() },
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
