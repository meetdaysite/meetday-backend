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
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      brandCommunityCollaborationMessage: {
        count: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      brandProfile: { findUnique: jest.fn() },
      hostProfile: { findUnique: jest.fn() },
    };

    storage = { getPresignedDownloadUrl: jest.fn() };
    notifications = {
      create: jest.fn().mockResolvedValue(undefined),
      markAllReadForThread: jest.fn().mockResolvedValue(undefined),
    };

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

  it('computes unreadCount from messages sent by counterpart since lastReadAt in getChats', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'brand-user-1',
      brandProfile: { id: 'brand-1', brandName: 'Brand Co.', logoKey: null },
      hostProfile: null,
      hostTeamMemberships: [],
    });

    const lastRead = new Date('2026-09-20T10:00:00Z');
    prisma.brandCommunityCollaborationInterest.findMany.mockResolvedValue([
      {
        id: 'interest-1',
        requesterBrandId: 'brand-1',
        targetCommunityId: 'community-1',
        chatStatus: 'ACCEPTED',
        requesterLastReadAt: lastRead,
        targetLastReadAt: null,
        requesterBrand: { brandName: 'Brand Co.', logoKey: null },
        targetCommunity: { name: 'Sunset House', logoKey: null },
        chatMessages: [{ content: 'Hello', mediaKey: null, createdAt: new Date() }],
        createdAt: new Date('2026-09-19T10:00:00Z'),
        lastMessageAt: new Date(),
      },
    ]);

    prisma.brandCommunityCollaborationMessage.count.mockResolvedValue(3);

    const chats = await service.getChats('brand-user-1', undefined, 'BRAND');

    expect(prisma.brandCommunityCollaborationMessage.count).toHaveBeenCalledWith({
      where: {
        collaborationId: 'interest-1',
        deletedAt: null,
        senderType: 'TARGET',
        createdAt: { gt: lastRead },
      },
    });
    expect(chats[0].unreadCount).toBe(3);
  });

  it('marks thread notifications as read when getMessages is called', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'brand-user-1',
      brandProfile: { id: 'brand-1', brandName: 'Brand Co.', logoKey: null },
      hostProfile: null,
      hostTeamMemberships: [],
    });

    prisma.brandCommunityCollaborationInterest.findUnique.mockResolvedValue({
      id: 'interest-1',
      requesterBrandId: 'brand-1',
      targetCommunityId: 'community-1',
      chatStatus: 'ACCEPTED',
      requesterBrand: { brandName: 'Brand Co.', logoKey: null },
      targetCommunity: { name: 'Sunset House', logoKey: null, hostProfile: { id: 'host-1' } },
    });

    prisma.brandCommunityCollaborationMessage.findMany.mockResolvedValue([]);
    prisma.brandCommunityCollaborationInterest.update.mockResolvedValue({});

    await service.getMessages('interest-1', 'brand-user-1', 'BRAND');

    expect(notifications.markAllReadForThread).toHaveBeenCalledWith('brand-user-1', 'interest-1');
  });

  describe('editMessage', () => {
    it('sender can edit their own message', async () => {
      const userId = 'brand-user-1';
      const interestId = 'interest-1';
      const messageId = 'msg-1';
      const newContent = 'Updated message';

      prisma.user.findUnique.mockResolvedValue({
        id: userId,
        brandProfile: { id: 'brand-1' },
        hostProfile: null,
        hostTeamMemberships: [],
      });

      prisma.brandCommunityCollaborationInterest.findUnique.mockResolvedValue({
        id: interestId,
        requesterBrandId: 'brand-1',
        targetCommunityId: 'community-1',
        chatStatus: 'ACCEPTED',
        requesterBrand: { brandName: 'Brand Co.' },
        targetCommunity: { name: 'Sunset House', hostProfile: { userId: 'community-owner' } },
      });

      const existingMessage = {
        id: messageId,
        collaborationId: interestId,
        senderId: userId,
        content: 'Original message',
        mediaKey: null,
        deletedAt: null,
      };

      prisma.brandCommunityCollaborationMessage.findUnique.mockResolvedValue(existingMessage);
      prisma.brandCommunityCollaborationMessage.update.mockResolvedValue({
        ...existingMessage,
        content: newContent,
        editedAt: new Date(),
        sender: { id: userId, firstName: 'John', lastName: 'Doe', avatarUrl: null },
      });

      const result = await service.editMessage(interestId, userId, messageId, { content: newContent });

      expect(prisma.brandCommunityCollaborationMessage.update).toHaveBeenCalledWith({
        where: { id: messageId },
        data: { content: newContent, editedAt: expect.any(Date) },
        include: { sender: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
      });
      expect(result.editedAt).toBeDefined();
    });

    it('non-sender cannot edit message', async () => {
      const userId = 'brand-user-1';
      const interestId = 'interest-1';
      const messageId = 'msg-1';

      prisma.user.findUnique.mockResolvedValue({
        id: userId,
        brandProfile: { id: 'brand-1' },
        hostProfile: null,
        hostTeamMemberships: [],
      });

      prisma.brandCommunityCollaborationInterest.findUnique.mockResolvedValue({
        id: interestId,
        requesterBrandId: 'brand-1',
        targetCommunityId: 'community-1',
        chatStatus: 'ACCEPTED',
        requesterBrand: { brandName: 'Brand Co.' },
        targetCommunity: { name: 'Sunset House', hostProfile: { userId: 'community-owner' } },
      });

      prisma.brandCommunityCollaborationMessage.findUnique.mockResolvedValue({
        id: messageId,
        collaborationId: interestId,
        senderId: 'different-user-id',
        content: 'Original message',
        mediaKey: null,
        deletedAt: null,
      });

      await expect(service.editMessage(interestId, userId, messageId, { content: 'New content' }))
        .rejects
        .toThrow('You can only edit your own messages');
    });

    it('cannot edit deleted message', async () => {
      const userId = 'brand-user-1';
      const interestId = 'interest-1';
      const messageId = 'msg-1';

      prisma.user.findUnique.mockResolvedValue({
        id: userId,
        brandProfile: { id: 'brand-1' },
        hostProfile: null,
        hostTeamMemberships: [],
      });

      prisma.brandCommunityCollaborationInterest.findUnique.mockResolvedValue({
        id: interestId,
        requesterBrandId: 'brand-1',
        targetCommunityId: 'community-1',
        chatStatus: 'ACCEPTED',
        requesterBrand: { brandName: 'Brand Co.' },
        targetCommunity: { name: 'Sunset House', hostProfile: { userId: 'community-owner' } },
      });

      prisma.brandCommunityCollaborationMessage.findUnique.mockResolvedValue({
        id: messageId,
        collaborationId: interestId,
        senderId: userId,
        content: 'Original message',
        mediaKey: null,
        deletedAt: new Date(),
      });

      await expect(service.editMessage(interestId, userId, messageId, { content: 'New content' }))
        .rejects
        .toThrow('Cannot edit a deleted message');
    });
  });

  describe('deleteMessage', () => {
    it('sender can delete their own message', async () => {
      const userId = 'brand-user-1';
      const interestId = 'interest-1';
      const messageId = 'msg-1';

      prisma.user.findUnique.mockResolvedValue({
        id: userId,
        brandProfile: { id: 'brand-1' },
        hostProfile: null,
        hostTeamMemberships: [],
      });

      prisma.brandCommunityCollaborationInterest.findUnique.mockResolvedValue({
        id: interestId,
        requesterBrandId: 'brand-1',
        targetCommunityId: 'community-1',
        chatStatus: 'ACCEPTED',
        requesterBrand: { brandName: 'Brand Co.' },
        targetCommunity: { name: 'Sunset House', hostProfile: { userId: 'community-owner' } },
      });

      prisma.brandCommunityCollaborationMessage.findUnique.mockResolvedValue({
        id: messageId,
        collaborationId: interestId,
        senderId: userId,
        content: 'Original message',
        mediaKey: null,
        deletedAt: null,
      });

      prisma.brandCommunityCollaborationMessage.update.mockResolvedValue({
        id: messageId,
        deletedAt: new Date(),
      });

      const result = await service.deleteMessage(interestId, userId, messageId);

      expect(prisma.brandCommunityCollaborationMessage.update).toHaveBeenCalledWith({
        where: { id: messageId },
        data: { deletedAt: expect.any(Date) },
      });
      expect(result.deleted).toBe(true);
    });

    it('non-sender cannot delete message', async () => {
      const userId = 'brand-user-1';
      const interestId = 'interest-1';
      const messageId = 'msg-1';

      prisma.user.findUnique.mockResolvedValue({
        id: userId,
        brandProfile: { id: 'brand-1' },
        hostProfile: null,
        hostTeamMemberships: [],
      });

      prisma.brandCommunityCollaborationInterest.findUnique.mockResolvedValue({
        id: interestId,
        requesterBrandId: 'brand-1',
        targetCommunityId: 'community-1',
        chatStatus: 'ACCEPTED',
        requesterBrand: { brandName: 'Brand Co.' },
        targetCommunity: { name: 'Sunset House', hostProfile: { userId: 'community-owner' } },
      });

      prisma.brandCommunityCollaborationMessage.findUnique.mockResolvedValue({
        id: messageId,
        collaborationId: interestId,
        senderId: 'different-user-id',
        content: 'Original message',
        mediaKey: null,
        deletedAt: null,
      });

      await expect(service.deleteMessage(interestId, userId, messageId))
        .rejects
        .toThrow('You can only delete your own messages');
    });

    it('idempotent deletion returns deleted state', async () => {
      const userId = 'brand-user-1';
      const interestId = 'interest-1';
      const messageId = 'msg-1';

      prisma.user.findUnique.mockResolvedValue({
        id: userId,
        brandProfile: { id: 'brand-1' },
        hostProfile: null,
        hostTeamMemberships: [],
      });

      prisma.brandCommunityCollaborationInterest.findUnique.mockResolvedValue({
        id: interestId,
        requesterBrandId: 'brand-1',
        targetCommunityId: 'community-1',
        chatStatus: 'ACCEPTED',
        requesterBrand: { brandName: 'Brand Co.' },
        targetCommunity: { name: 'Sunset House', hostProfile: { userId: 'community-owner' } },
      });

      prisma.brandCommunityCollaborationMessage.findUnique.mockResolvedValue({
        id: messageId,
        collaborationId: interestId,
        senderId: userId,
        content: 'Original message',
        mediaKey: null,
        deletedAt: new Date('2026-10-10T00:00:00Z'),
      });

      const result = await service.deleteMessage(interestId, userId, messageId);

      expect(result.deleted).toBe(true);
      expect(result.message).toBe('Already deleted');
      expect(prisma.brandCommunityCollaborationMessage.update).not.toHaveBeenCalled();
    });
  });
});

