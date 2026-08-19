import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bull';
import { SponsorshipService } from './sponsorship.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditLogService } from '../audit-log/audit-log.service';

function makePrisma() {
  const prisma: any = {
    hostProfile: { findUnique: jest.fn() },
    brandProfile: { findUnique: jest.fn() },
    sponsorshipInterest: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    sponsorshipChatMessage: { findMany: jest.fn(), create: jest.fn(), count: jest.fn().mockResolvedValue(0) },
    sponsorshipDeal: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
  return prisma;
}

const mockNotifications = { create: jest.fn().mockResolvedValue(undefined) };
const mockMailQueue = { add: jest.fn().mockResolvedValue(undefined) };

describe('SponsorshipService — TriChat', () => {
  let service: SponsorshipService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        SponsorshipService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: { getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://cdn.example.com/x') } },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        { provide: getQueueToken('mail'), useValue: mockMailQueue },
      ],
    }).compile();

    service = module.get(SponsorshipService);
  });

  describe('listMyChats()', () => {
    it('filters by the caller\u2019s hostProfile when they are a host', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue({ id: 'host-1' });
      prisma.brandProfile.findUnique.mockResolvedValue(null);
      prisma.sponsorshipInterest.findMany.mockResolvedValue([]);

      await service.listMyChats('user-1', {});

      expect(prisma.sponsorshipInterest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ sponsorshipProposal: { hostProfileId: 'host-1' } }) }),
      );
    });

    it('filters by the caller\u2019s brandProfileId when they are a brand', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue(null);
      prisma.brandProfile.findUnique.mockResolvedValue({ id: 'brand-1' });
      prisma.sponsorshipInterest.findMany.mockResolvedValue([]);

      await service.listMyChats('user-2', {});

      expect(prisma.sponsorshipInterest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ brandProfileId: 'brand-1' }) }),
      );
    });

    it('throws NotFoundException when the user has neither profile', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue(null);
      prisma.brandProfile.findUnique.mockResolvedValue(null);

      await expect(service.listMyChats('user-3', {})).rejects.toThrow(NotFoundException);
    });

    it('computes unreadCount from messages sent by the other side since I last read', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue({ id: 'host-1' });
      prisma.brandProfile.findUnique.mockResolvedValue(null);
      prisma.sponsorshipInterest.findMany.mockResolvedValue([
        {
          id: 'interest-1',
          chatStatus: 'ACCEPTED',
          createdAt: new Date(),
          chatAcceptedAt: new Date(),
          lastMessageAt: new Date(),
          hostLastReadAt: new Date('2026-01-01'),
          brandLastReadAt: null,
          sponsorshipProposal: { id: 'prop-1', name: 'Proposal', hostProfile: { displayName: 'Host', communityProfile: null } },
          brandProfile: { id: 'brand-1', brandName: 'Acme' },
          chatMessages: [{ content: 'hi', mediaKey: null, senderType: 'BRAND', createdAt: new Date() }],
        },
      ]);
      prisma.sponsorshipChatMessage.count.mockResolvedValue(3);

      const result = await service.listMyChats('user-1', {});

      expect(prisma.sponsorshipChatMessage.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ senderType: 'BRAND' }) }),
      );
      expect(result[0].unreadCount).toBe(3);
    });
  });

  describe('sendChatMessage()', () => {
    const baseInterest = {
      id: 'interest-1',
      chatStatus: 'ACCEPTED',
      sponsorshipProposal: { id: 'prop-1', name: 'Proposal', hostProfile: { id: 'host-1', userId: 'host-user' } },
      brandProfile: { id: 'brand-1', userId: 'brand-user' },
    };

    it('sends as HOST when the caller owns the proposal', async () => {
      prisma.sponsorshipInterest.findUnique.mockResolvedValue(baseInterest);
      prisma.sponsorshipChatMessage.create.mockResolvedValue({ id: 'msg-1', createdAt: new Date() });

      await service.sendChatMessage('host-user', 'interest-1', { content: 'hello' });

      expect(prisma.sponsorshipChatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ senderType: 'HOST', senderId: 'host-user', content: 'hello' }) }),
      );
      expect(mockNotifications.create).toHaveBeenCalledWith('brand-user', expect.any(String), expect.any(String), expect.any(String), expect.any(Object));
    });

    it('rejects a participant not on this thread', async () => {
      prisma.sponsorshipInterest.findUnique.mockResolvedValue(baseInterest);
      await expect(service.sendChatMessage('someone-else', 'interest-1', { content: 'hi' })).rejects.toThrow(ForbiddenException);
    });

    it('rejects sending before the request is accepted', async () => {
      prisma.sponsorshipInterest.findUnique.mockResolvedValue({ ...baseInterest, chatStatus: 'REQUESTED' });
      await expect(service.sendChatMessage('host-user', 'interest-1', { content: 'hi' })).rejects.toThrow(BadRequestException);
    });

    it('masks an email/phone number before saving and flags wasRedacted', async () => {
      prisma.sponsorshipInterest.findUnique.mockResolvedValue(baseInterest);
      prisma.sponsorshipChatMessage.create.mockResolvedValue({ id: 'msg-1', createdAt: new Date() });

      const result = await service.sendChatMessage('host-user', 'interest-1', {
        content: 'call me at hello@example.com',
      });

      expect(prisma.sponsorshipChatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ content: expect.stringContaining('h***@example.com') }) }),
      );
      expect(result.wasRedacted).toBe(true);
    });

    it('rejects an empty message with no text and no image', async () => {
      prisma.sponsorshipInterest.findUnique.mockResolvedValue(baseInterest);
      await expect(service.sendChatMessage('host-user', 'interest-1', {})).rejects.toThrow(BadRequestException);
    });

    it('allows an image-only message and returns a signed mediaUrl', async () => {
      prisma.sponsorshipInterest.findUnique.mockResolvedValue(baseInterest);
      prisma.sponsorshipChatMessage.create.mockResolvedValue({ id: 'msg-1', createdAt: new Date() });

      const result = await service.sendChatMessage('host-user', 'interest-1', { mediaKey: 'sponsorship-chats/interest-1/x.jpg' });

      expect(prisma.sponsorshipChatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ content: '', mediaKey: 'sponsorship-chats/interest-1/x.jpg' }) }),
      );
      expect(result.mediaUrl).toBe('https://cdn.example.com/x');
    });
  });

  describe('acceptChatRequest()', () => {
    it('only allows the owning host to accept', async () => {
      prisma.sponsorshipInterest.findUnique.mockResolvedValue({
        id: 'interest-1',
        chatStatus: 'REQUESTED',
        sponsorshipProposal: { hostProfile: { userId: 'host-user' } },
        brandProfile: { userId: 'brand-user', brandName: 'Acme' },
      });

      await expect(service.acceptChatRequest('brand-user', 'interest-1')).rejects.toThrow(ForbiddenException);
    });

    it('moves the thread to ACCEPTED and notifies the brand', async () => {
      prisma.sponsorshipInterest.findUnique.mockResolvedValue({
        id: 'interest-1',
        chatStatus: 'REQUESTED',
        sponsorshipProposal: { hostProfile: { userId: 'host-user' } },
        brandProfile: { userId: 'brand-user', brandName: 'Acme' },
      });
      prisma.sponsorshipInterest.update.mockResolvedValue({ chatStatus: 'ACCEPTED' });

      const result = await service.acceptChatRequest('host-user', 'interest-1');

      expect(result.chatStatus).toBe('ACCEPTED');
      expect(mockNotifications.create).toHaveBeenCalledWith('brand-user', expect.any(String), expect.any(String), expect.any(String), expect.any(Object));
    });
  });

  describe('Deal Lock', () => {
    const dealInterest = {
      id: 'interest-1',
      chatStatus: 'ACCEPTED',
      sponsorshipProposal: {
        id: 'prop-1',
        name: 'Proposal',
        hostProfile: { id: 'host-1', userId: 'host-user', displayName: 'Host Display', communityProfile: { name: 'Cool Community' } },
      },
      brandProfile: { id: 'brand-1', userId: 'brand-user', brandName: 'Acme' },
    };

    const dealDto = {
      eventName: 'Summer Fest',
      eventDate: '2026-12-05T00:00:00.000Z',
      venue: 'Phoenix Marketcity',
      finalAmount: 45000,
      deliverables: 'Logo on backdrop',
    };

    describe('createDeal()', () => {
      it('rejects a non-host caller', async () => {
        prisma.sponsorshipInterest.findUnique.mockResolvedValue(dealInterest);
        await expect(service.createDeal('brand-user', 'interest-1', dealDto)).rejects.toThrow(ForbiddenException);
      });

      it('rejects when the chat is not yet accepted', async () => {
        prisma.sponsorshipInterest.findUnique.mockResolvedValue({ ...dealInterest, chatStatus: 'REQUESTED' });
        await expect(service.createDeal('host-user', 'interest-1', dealDto)).rejects.toThrow(BadRequestException);
      });

      it('rejects if a deal already exists', async () => {
        prisma.sponsorshipInterest.findUnique.mockResolvedValue(dealInterest);
        prisma.sponsorshipDeal.findUnique.mockResolvedValue({ id: 'deal-1', status: 'PENDING_APPROVAL' });
        await expect(service.createDeal('host-user', 'interest-1', dealDto)).rejects.toThrow(BadRequestException);
      });

      it('creates the deal, posts a system message, and notifies the brand', async () => {
        prisma.sponsorshipInterest.findUnique.mockResolvedValue(dealInterest);
        prisma.sponsorshipDeal.findUnique.mockResolvedValue(null);
        prisma.sponsorshipDeal.create.mockResolvedValue({ id: 'deal-1', status: 'PENDING_APPROVAL' });
        prisma.sponsorshipChatMessage.create.mockResolvedValue({ id: 'msg-1', createdAt: new Date() });

        await service.createDeal('host-user', 'interest-1', dealDto);

        expect(prisma.sponsorshipDeal.create).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ sponsorshipInterestId: 'interest-1', eventName: 'Summer Fest', createdById: 'host-user' }) }),
        );
        expect(prisma.sponsorshipChatMessage.create).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ messageType: 'SYSTEM', senderType: 'HOST' }) }),
        );
        expect(mockNotifications.create).toHaveBeenCalledWith('brand-user', 'sponsorship_deal_submitted', expect.any(String), expect.any(String), expect.any(Object));
      });
    });

    describe('updateDeal()', () => {
      it('rejects a non-host caller', async () => {
        prisma.sponsorshipInterest.findUnique.mockResolvedValue(dealInterest);
        await expect(service.updateDeal('brand-user', 'interest-1', dealDto)).rejects.toThrow(ForbiddenException);
      });

      it('throws NotFoundException when no deal exists yet', async () => {
        prisma.sponsorshipInterest.findUnique.mockResolvedValue(dealInterest);
        prisma.sponsorshipDeal.findUnique.mockResolvedValue(null);
        await expect(service.updateDeal('host-user', 'interest-1', dealDto)).rejects.toThrow(NotFoundException);
      });

      it('rejects editing an already-approved deal', async () => {
        prisma.sponsorshipInterest.findUnique.mockResolvedValue(dealInterest);
        prisma.sponsorshipDeal.findUnique.mockResolvedValue({ id: 'deal-1', status: 'APPROVED' });
        await expect(service.updateDeal('host-user', 'interest-1', dealDto)).rejects.toThrow(BadRequestException);
      });

      it('bumps version, resets status to PENDING_APPROVAL, and notifies the brand', async () => {
        prisma.sponsorshipInterest.findUnique.mockResolvedValue(dealInterest);
        prisma.sponsorshipDeal.findUnique.mockResolvedValue({ id: 'deal-1', status: 'CHANGES_REQUESTED' });
        prisma.sponsorshipDeal.update.mockResolvedValue({ id: 'deal-1', status: 'PENDING_APPROVAL', version: 2 });
        prisma.sponsorshipChatMessage.create.mockResolvedValue({ id: 'msg-1', createdAt: new Date() });

        await service.updateDeal('host-user', 'interest-1', dealDto);

        expect(prisma.sponsorshipDeal.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'deal-1' },
            data: expect.objectContaining({ status: 'PENDING_APPROVAL', changeRequestNote: null, version: { increment: 1 } }),
          }),
        );
        expect(mockNotifications.create).toHaveBeenCalledWith('brand-user', 'sponsorship_deal_updated', expect.any(String), expect.any(String), expect.any(Object));
      });
    });

    describe('approveDeal()', () => {
      it('rejects a non-brand caller', async () => {
        prisma.sponsorshipInterest.findUnique.mockResolvedValue(dealInterest);
        await expect(service.approveDeal('host-user', 'interest-1')).rejects.toThrow(ForbiddenException);
      });

      it('throws NotFoundException when no deal exists', async () => {
        prisma.sponsorshipInterest.findUnique.mockResolvedValue(dealInterest);
        prisma.sponsorshipDeal.findUnique.mockResolvedValue(null);
        await expect(service.approveDeal('brand-user', 'interest-1')).rejects.toThrow(NotFoundException);
      });

      it('locks the deal, posts a congratulations system message, and notifies the host', async () => {
        prisma.sponsorshipInterest.findUnique.mockResolvedValue(dealInterest);
        prisma.sponsorshipDeal.findUnique.mockResolvedValue({ id: 'deal-1', status: 'PENDING_APPROVAL', eventName: 'Summer Fest' });
        prisma.sponsorshipDeal.update.mockResolvedValue({ id: 'deal-1', status: 'APPROVED' });
        prisma.sponsorshipChatMessage.create.mockResolvedValue({ id: 'msg-1', createdAt: new Date() });

        const result = await service.approveDeal('brand-user', 'interest-1');

        expect(result.status).toBe('APPROVED');
        expect(prisma.sponsorshipChatMessage.create).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ messageType: 'SYSTEM', senderType: 'BRAND', content: expect.stringContaining('locked') }) }),
        );
        expect(mockNotifications.create).toHaveBeenCalledWith('host-user', 'sponsorship_deal_locked', expect.any(String), expect.any(String), expect.any(Object));
      });
    });

    describe('requestDealChanges()', () => {
      it('rejects a non-brand caller', async () => {
        prisma.sponsorshipInterest.findUnique.mockResolvedValue(dealInterest);
        await expect(service.requestDealChanges('host-user', 'interest-1', {})).rejects.toThrow(ForbiddenException);
      });

      it('rejects requesting changes on an already-approved deal', async () => {
        prisma.sponsorshipInterest.findUnique.mockResolvedValue(dealInterest);
        prisma.sponsorshipDeal.findUnique.mockResolvedValue({ id: 'deal-1', status: 'APPROVED' });
        await expect(service.requestDealChanges('brand-user', 'interest-1', {})).rejects.toThrow(BadRequestException);
      });

      it('marks CHANGES_REQUESTED, saves the note, and notifies the host', async () => {
        prisma.sponsorshipInterest.findUnique.mockResolvedValue(dealInterest);
        prisma.sponsorshipDeal.findUnique.mockResolvedValue({ id: 'deal-1', status: 'PENDING_APPROVAL' });
        prisma.sponsorshipDeal.update.mockResolvedValue({ id: 'deal-1', status: 'CHANGES_REQUESTED' });
        prisma.sponsorshipChatMessage.create.mockResolvedValue({ id: 'msg-1', createdAt: new Date() });

        await service.requestDealChanges('brand-user', 'interest-1', { note: 'Please revisit the price' });

        expect(prisma.sponsorshipDeal.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: { status: 'CHANGES_REQUESTED', changeRequestNote: 'Please revisit the price' } }),
        );
        expect(mockNotifications.create).toHaveBeenCalledWith('host-user', 'sponsorship_deal_changes_requested', expect.any(String), expect.any(String), expect.any(Object));
      });
    });
  });
});
