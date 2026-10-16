import { CommunityCollaborationService } from './community-collaboration.service';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';

describe('CommunityCollaborationService - Message Edit/Delete', () => {
  let service: CommunityCollaborationService;
  let prisma: any;
  let storage: any;

  beforeEach(() => {
    prisma = {
      hostCommunityProfile: {
        findFirst: jest.fn(),
      },
      communityCollaborationInterest: {
        findUnique: jest.fn(),
      },
      communityCollaborationMessage: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    storage = {
      getPresignedDownloadUrl: jest.fn(),
    };

    service = new CommunityCollaborationService(prisma, storage);
  });

  describe('editCollaborationMessage', () => {
    it('sender can edit their own message', async () => {
      const userId = 'community-user-1';
      const communityId = 'community-1';
      const interestId = 'interest-1';
      const messageId = 'msg-1';
      const newContent = 'Updated message';

      prisma.hostCommunityProfile.findFirst.mockResolvedValue({
        id: 'community-1',
      });

      prisma.communityCollaborationInterest.findUnique.mockResolvedValue({
        id: interestId,
      });

      const existingMessage = {
        id: messageId,
        communityCollaborationId: interestId,
        senderId: userId,
        content: 'Original message',
        mediaKey: null,
        deletedAt: null,
      };

      prisma.communityCollaborationMessage.findUnique.mockResolvedValue(existingMessage);
      prisma.communityCollaborationMessage.update.mockResolvedValue({
        ...existingMessage,
        content: newContent,
        editedAt: new Date(),
        sender: { id: userId, firstName: 'John', lastName: 'Doe', avatarUrl: null },
        replyTo: null,
      });

      storage.getPresignedDownloadUrl.mockResolvedValue('https://example.com/media');

      const result = await service.editCollaborationMessage(
        interestId,
        communityId,
        userId,
        messageId,
        { content: newContent },
      );

      expect(prisma.communityCollaborationMessage.update).toHaveBeenCalledWith({
        where: { id: messageId },
        data: { content: newContent, editedAt: expect.any(Date) },
        include: {
          sender: {
            select: { id: true, firstName: true, lastName: true, avatarUrl: true },
          },
          replyTo: {
            include: {
              sender: {
                select: { firstName: true, lastName: true },
              },
            },
          },
        },
      });
      expect(result.editedAt).toBeDefined();
    });

    it('non-sender cannot edit message', async () => {
      const userId = 'community-user-1';
      const communityId = 'community-1';
      const interestId = 'interest-1';
      const messageId = 'msg-1';

      prisma.hostCommunityProfile.findFirst.mockResolvedValue({
        id: 'community-1',
      });

      prisma.communityCollaborationInterest.findUnique.mockResolvedValue({
        id: interestId,
      });

      prisma.communityCollaborationMessage.findUnique.mockResolvedValue({
        id: messageId,
        communityCollaborationId: interestId,
        senderId: 'different-user-id',
        content: 'Original message',
        mediaKey: null,
        deletedAt: null,
      });

      await expect(
        service.editCollaborationMessage(interestId, communityId, userId, messageId, { content: 'New content' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('cannot edit deleted message', async () => {
      const userId = 'community-user-1';
      const communityId = 'community-1';
      const interestId = 'interest-1';
      const messageId = 'msg-1';

      prisma.hostCommunityProfile.findFirst.mockResolvedValue({
        id: 'community-1',
      });

      prisma.communityCollaborationInterest.findUnique.mockResolvedValue({
        id: interestId,
      });

      prisma.communityCollaborationMessage.findUnique.mockResolvedValue({
        id: messageId,
        communityCollaborationId: interestId,
        senderId: userId,
        content: 'Original message',
        mediaKey: null,
        deletedAt: new Date(),
      });

      await expect(
        service.editCollaborationMessage(interestId, communityId, userId, messageId, { content: 'New content' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when message not found in thread', async () => {
      const userId = 'community-user-1';
      const communityId = 'community-1';
      const interestId = 'interest-1';
      const messageId = 'msg-1';

      prisma.hostCommunityProfile.findFirst.mockResolvedValue({
        id: 'community-1',
      });

      prisma.communityCollaborationInterest.findUnique.mockResolvedValue({
        id: interestId,
      });

      prisma.communityCollaborationMessage.findUnique.mockResolvedValue({
        id: messageId,
        communityCollaborationId: 'different-interest-id',
        senderId: userId,
        content: 'Original message',
        mediaKey: null,
        deletedAt: null,
      });

      await expect(
        service.editCollaborationMessage(interestId, communityId, userId, messageId, { content: 'New content' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteCollaborationMessage', () => {
    it('sender can delete their own message', async () => {
      const userId = 'community-user-1';
      const communityId = 'community-1';
      const interestId = 'interest-1';
      const messageId = 'msg-1';

      prisma.hostCommunityProfile.findFirst.mockResolvedValue({
        id: 'community-1',
      });

      prisma.communityCollaborationInterest.findUnique.mockResolvedValue({
        id: interestId,
      });

      prisma.communityCollaborationMessage.findUnique.mockResolvedValue({
        id: messageId,
        communityCollaborationId: interestId,
        senderId: userId,
        content: 'Original message',
        mediaKey: null,
        deletedAt: null,
      });

      prisma.communityCollaborationMessage.update.mockResolvedValue({
        id: messageId,
        deletedAt: new Date(),
      });

      const result = await service.deleteCollaborationMessage(interestId, communityId, userId, messageId);

      expect(prisma.communityCollaborationMessage.update).toHaveBeenCalledWith({
        where: { id: messageId },
        data: { deletedAt: expect.any(Date) },
      });
      expect(result.deleted).toBe(true);
    });

    it('non-sender cannot delete message', async () => {
      const userId = 'community-user-1';
      const communityId = 'community-1';
      const interestId = 'interest-1';
      const messageId = 'msg-1';

      prisma.hostCommunityProfile.findFirst.mockResolvedValue({
        id: 'community-1',
      });

      prisma.communityCollaborationInterest.findUnique.mockResolvedValue({
        id: interestId,
      });

      prisma.communityCollaborationMessage.findUnique.mockResolvedValue({
        id: messageId,
        communityCollaborationId: interestId,
        senderId: 'different-user-id',
        content: 'Original message',
        mediaKey: null,
        deletedAt: null,
      });

      await expect(
        service.deleteCollaborationMessage(interestId, communityId, userId, messageId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('idempotent deletion returns deleted state', async () => {
      const userId = 'community-user-1';
      const communityId = 'community-1';
      const interestId = 'interest-1';
      const messageId = 'msg-1';

      prisma.hostCommunityProfile.findFirst.mockResolvedValue({
        id: 'community-1',
      });

      prisma.communityCollaborationInterest.findUnique.mockResolvedValue({
        id: interestId,
      });

      prisma.communityCollaborationMessage.findUnique.mockResolvedValue({
        id: messageId,
        communityCollaborationId: interestId,
        senderId: userId,
        content: 'Original message',
        mediaKey: null,
        deletedAt: new Date('2026-10-10T00:00:00Z'),
      });

      const result = await service.deleteCollaborationMessage(interestId, communityId, userId, messageId);

      expect(result.deleted).toBe(true);
      expect(result.message).toBe('Already deleted');
      expect(prisma.communityCollaborationMessage.update).not.toHaveBeenCalled();
    });

    it('throws when interest not found', async () => {
      const userId = 'community-user-1';
      const communityId = 'community-1';
      const interestId = 'interest-1';
      const messageId = 'msg-1';

      prisma.hostCommunityProfile.findFirst.mockResolvedValue({
        id: 'community-1',
      });

      prisma.communityCollaborationInterest.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteCollaborationMessage(interestId, communityId, userId, messageId),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
