import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnreadChatMailProcessor } from './unread-chat-mail.processor';
import { PrismaService } from '../../../prisma/prisma.service';
import { MailService } from '../../../common/mail/mail.service';

function makePrisma() {
  return {
    sponsorshipInterest: { findUnique: jest.fn() },
    sponsorshipChatMessage: { count: jest.fn() },
    user: { findUnique: jest.fn() },
  } as any;
}

describe('UnreadChatMailProcessor', () => {
  let processor: UnreadChatMailProcessor;
  let prisma: ReturnType<typeof makePrisma>;
  let mockMailService: { sendUnreadChatMessage: jest.Mock };

  const baseInterest = {
    id: 'interest-1',
    hostLastReadAt: null,
    brandLastReadAt: null,
    sponsorshipProposal: { hostProfile: { userId: 'host-user' } },
    brandProfile: { userId: 'brand-user' },
  };

  beforeEach(async () => {
    prisma = makePrisma();
    mockMailService = { sendUnreadChatMessage: jest.fn().mockResolvedValue(undefined) };
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        UnreadChatMailProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: mockMailService },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('https://app.meetday.ai') } },
      ],
    }).compile();

    processor = module.get(UnreadChatMailProcessor);
  });

  function job(data: { interestId: string; recipientUserId: string }) {
    return { data } as any;
  }

  it('sends an email when the recipient still has unread messages', async () => {
    prisma.sponsorshipInterest.findUnique.mockResolvedValue(baseInterest);
    prisma.sponsorshipChatMessage.count.mockResolvedValue(3);
    prisma.user.findUnique.mockResolvedValue({ email: 'brand@example.com', firstName: 'Alex' });

    await processor.handle(job({ interestId: 'interest-1', recipientUserId: 'brand-user' }));

    expect(mockMailService.sendUnreadChatMessage).toHaveBeenCalledWith(
      'brand@example.com',
      'Alex',
      3,
      expect.stringContaining('/brand/dashboard/chats?interestId=interest-1'),
    );
  });

  it('skips sending when the recipient has already read everything', async () => {
    prisma.sponsorshipInterest.findUnique.mockResolvedValue(baseInterest);
    prisma.sponsorshipChatMessage.count.mockResolvedValue(0);

    await processor.handle(job({ interestId: 'interest-1', recipientUserId: 'brand-user' }));

    expect(mockMailService.sendUnreadChatMessage).not.toHaveBeenCalled();
  });

  it('builds a host dashboard link when the recipient is the host', async () => {
    prisma.sponsorshipInterest.findUnique.mockResolvedValue(baseInterest);
    prisma.sponsorshipChatMessage.count.mockResolvedValue(1);
    prisma.user.findUnique.mockResolvedValue({ email: 'host@example.com', firstName: 'Sam' });

    await processor.handle(job({ interestId: 'interest-1', recipientUserId: 'host-user' }));

    expect(mockMailService.sendUnreadChatMessage).toHaveBeenCalledWith(
      'host@example.com',
      'Sam',
      1,
      expect.stringContaining('/community/dashboard/chats?interestId=interest-1'),
    );
  });

  it('does nothing for an unknown thread', async () => {
    prisma.sponsorshipInterest.findUnique.mockResolvedValue(null);
    await processor.handle(job({ interestId: 'bad-id', recipientUserId: 'brand-user' }));
    expect(mockMailService.sendUnreadChatMessage).not.toHaveBeenCalled();
  });

  it('does nothing if the recipient has no email on file', async () => {
    prisma.sponsorshipInterest.findUnique.mockResolvedValue(baseInterest);
    prisma.sponsorshipChatMessage.count.mockResolvedValue(2);
    prisma.user.findUnique.mockResolvedValue({ email: null, firstName: 'Alex' });

    await processor.handle(job({ interestId: 'interest-1', recipientUserId: 'brand-user' }));

    expect(mockMailService.sendUnreadChatMessage).not.toHaveBeenCalled();
  });
});
