import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bull';
import { ChatSenderType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { MailService } from '../../../common/mail/mail.service';

export type UnreadChatMessageCheckJob = { interestId: string; recipientUserId: string };

// Fired after a grace period (see UNREAD_CHAT_EMAIL_DELAY_MINUTES) following a TriChat message —
// re-checks whether the recipient has since read it before sending a fallback "you have unread
// messages" email. Multiple messages in the window collapse into this one check (see the
// deduped jobId at the enqueue site), so the email always reflects the current unread count.
@Processor('mail')
export class UnreadChatMailProcessor {
  private readonly logger = new Logger(UnreadChatMailProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  @Process('unread-chat-message-check')
  async handle(job: Job<UnreadChatMessageCheckJob>) {
    try {
      const { interestId, recipientUserId } = job.data;

      const interest = await this.prisma.sponsorshipInterest.findUnique({
        where: { id: interestId },
        include: {
          sponsorshipProposal: { select: { hostProfile: { select: { userId: true } } } },
          brandProfile: { select: { userId: true } },
        },
      });
      if (!interest) return;

      const isHostRecipient = interest.sponsorshipProposal.hostProfile.userId === recipientUserId;
      const isBrandRecipient = interest.brandProfile.userId === recipientUserId;
      if (!isHostRecipient && !isBrandRecipient) return;

      const lastReadAt = isHostRecipient ? interest.hostLastReadAt : interest.brandLastReadAt;
      const otherSenderTypes: ChatSenderType[] = isHostRecipient
        ? [ChatSenderType.BRAND, ChatSenderType.ADMIN]
        : [ChatSenderType.HOST, ChatSenderType.ADMIN];

      const unreadCount = await this.prisma.sponsorshipChatMessage.count({
        where: {
          sponsorshipInterestId: interestId,
          senderType: { in: otherSenderTypes },
          deletedAt: null,
          ...(lastReadAt && { createdAt: { gt: lastReadAt } }),
        },
      });
      if (unreadCount === 0) return; // Read before the grace period elapsed — nothing to send.

      const recipient = await this.prisma.user.findUnique({
        where: { id: recipientUserId },
        select: { email: true, firstName: true },
      });
      if (!recipient?.email) return;

      const frontendUrl = this.configService.get<string>('frontendUrl');
      const ctaPath = isHostRecipient ? '/community/dashboard/chats' : '/brand/dashboard/chats';
      const ctaUrl = `${frontendUrl}${ctaPath}?interestId=${interestId}`;

      await this.mailService.sendUnreadChatMessage(recipient.email, recipient.firstName || 'there', unreadCount, ctaUrl);
    } catch (error) {
      this.logger.error(`Failed to process unread-chat-message-check job: ${(error as Error).message}`);
    }
  }
}
