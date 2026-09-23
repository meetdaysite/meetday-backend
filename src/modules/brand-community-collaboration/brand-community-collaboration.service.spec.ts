import { BrandCommunityCollaborationService } from './brand-community-collaboration.service';

describe('BrandCommunityCollaborationService', () => {
  let service: BrandCommunityCollaborationService;
  let prisma: any;
  let storage: any;
  let notifications: any;

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn() },
      hostCommunityProfile: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
      brandCommunityCollaborationInterest: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      brandProfile: { findUnique: jest.fn() },
      hostProfile: { findUnique: jest.fn() },
    };

    storage = { getPresignedDownloadUrl: jest.fn() };
    notifications = { create: jest.fn().mockResolvedValue(undefined) };

    service = new BrandCommunityCollaborationService(prisma, storage, notifications);
  });

  it('notifies the community owner and team when a brand requests collaboration', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'brand-user-1',
      brandProfile: { id: 'brand-1', brandName: 'Brand Co.', logoKey: null },
      hostProfile: null,
      hostTeamMemberships: [],
    });

    prisma.hostCommunityProfile.findFirst.mockResolvedValue({
      id: 'community-1',
      hostProfileId: 'host-1',
      name: 'Sunset House',
      logoKey: null,
      approvalStatus: 'APPROVED',
      isHidden: false,
    });

    prisma.brandCommunityCollaborationInterest.findUnique.mockResolvedValue(null);
    prisma.brandCommunityCollaborationInterest.create.mockResolvedValue({
      id: 'interest-1',
      requesterBrandId: 'brand-1',
      targetCommunityId: 'community-1',
      chatStatus: 'REQUESTED',
    });

    prisma.hostCommunityProfile.findUnique.mockResolvedValue({ hostProfileId: 'host-1' });
    prisma.hostProfile.findUnique.mockResolvedValue({
      userId: 'community-owner',
      teamMembers: [{ userId: 'community-team-member' }],
    });

    await service.markInterest('community-1', 'brand-user-1');

    expect(notifications.create).toHaveBeenCalledWith(
      'community-owner',
      'brand_community_chat_message',
      'Brand Co. wants to collaborate',
      expect.stringContaining('collaboration request'),
      expect.objectContaining({
        brandCommunityInterestId: 'interest-1',
        interestId: 'interest-1',
        collaborationType: 'BRAND_COMMUNITY',
      }),
    );
    expect(notifications.create).toHaveBeenCalledWith(
      'community-team-member',
      'brand_community_chat_message',
      'Brand Co. wants to collaborate',
      expect.stringContaining('collaboration request'),
      expect.objectContaining({ brandCommunityInterestId: 'interest-1' }),
    );
  });

  it('notifies the brand owner and team when a community accepts the request', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'community-user-1',
      brandProfile: null,
      hostProfile: { communityProfile: { id: 'community-1', name: 'Sunset House', logoKey: null } },
      hostTeamMemberships: [],
    });

    prisma.brandCommunityCollaborationInterest.findUnique.mockResolvedValue({
      id: 'interest-1',
      requesterBrandId: 'brand-1',
      targetCommunityId: 'community-1',
      chatStatus: 'REQUESTED',
      requesterBrand: { brandName: 'Brand Co.' },
      targetCommunity: { name: 'Sunset House', hostProfile: { userId: 'community-owner' } },
    });

    prisma.brandCommunityCollaborationInterest.update.mockResolvedValue({
      id: 'interest-1',
      chatStatus: 'ACCEPTED',
    });

    prisma.brandProfile.findUnique.mockResolvedValue({
      userId: 'brand-owner',
      teamMembers: [{ userId: 'brand-team-member' }],
    });

    prisma.hostProfile.findUnique.mockResolvedValue({
      userId: 'community-owner',
      teamMembers: [],
    });

    await service.accept('interest-1', 'community-user-1');

    expect(notifications.create).toHaveBeenCalledWith(
      'brand-owner',
      'brand_community_chat_message',
      'Sunset House accepted your collaboration request',
      'Your collaboration request with Sunset House is now active.',
      expect.objectContaining({
        brandCommunityInterestId: 'interest-1',
        interestId: 'interest-1',
        collaborationType: 'BRAND_COMMUNITY',
      }),
    );
  });
});
