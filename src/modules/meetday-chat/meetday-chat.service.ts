import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { SendChatMessageDto } from '../sponsorship/dto/send-chat-message.dto';
import { redactPersonalInfo } from '../../common/utils/redact-personal-info.util';
import { NotificationsService } from '../notifications/notifications.service';

const ADMIN_ROLES = ['SUPER_ADMIN', 'CITY_ADMIN', 'MODERATOR'];
const AGENT_WAIT_MESSAGE = 'Our support team will get back to you within 2 hours.';
const AGENT_OFFER_MESSAGE = 'Would you like to talk to a Meetday agent?';
const AFFIRMATIVE_RE = /^\s*(yes|yeah|yep|yup|sure|ok(ay)?|please|pls|haan?|han|ji|zaroor)\b/i;

// General "Talk to Meetday" support chat — one thread per Host/Brand user, independent of any
// specific sponsorship interest (unlike TriChat).
@Injectable()
export class MeetdayChatService {
  private readonly logger = new Logger(MeetdayChatService.name);
  private readonly aiServerUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly config: ConfigService,
    private readonly notificationsService: NotificationsService,
  ) {
    this.aiServerUrl = this.config.get<string>('aiServerUrl')!;
  }

  private async getOrCreateThread(userId: string) {
    return this.prisma.meetdayChatThread.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  private async withMediaUrls<T extends { mediaKey: string | null }>(
    messages: T[],
  ): Promise<Array<Omit<T, 'mediaKey'> & { mediaUrl: string | null }>> {
    return Promise.all(
      messages.map(async ({ mediaKey, ...m }) => ({
        ...m,
        mediaUrl: mediaKey ? await this.storageService.getPresignedDownloadUrl(mediaKey) : null,
      })),
    );
  }

  async getMyChat(userId: string) {
    const thread = await this.getOrCreateThread(userId);
    const messages = await this.prisma.meetdayChatMessage.findMany({
      where: { threadId: thread.id },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: { id: true, senderType: true, senderId: true, content: true, mediaKey: true, createdAt: true },
    });

    void this.prisma.meetdayChatThread
      .update({ where: { id: thread.id }, data: { userLastReadAt: new Date() } })
      .catch((err) => this.logger.error('Failed to update Meetday chat read state', err));

    return { messages: await this.withMediaUrls(messages) };
  }

  async sendMyMessage(userId: string, dto: SendChatMessageDto) {
    if (!dto.content?.trim() && !dto.mediaKey) {
      throw new BadRequestException('Message must have text or an image');
    }
    const thread = await this.getOrCreateThread(userId);
    const { content, wasRedacted } = dto.content ? redactPersonalInfo(dto.content) : { content: '', wasRedacted: false };

    const message = await this.prisma.meetdayChatMessage.create({
      data: { threadId: thread.id, senderType: 'USER', senderId: userId, content, mediaKey: dto.mediaKey },
    });
    await this.prisma.meetdayChatThread.update({
      where: { id: thread.id },
      data: { lastMessageAt: message.createdAt, userLastReadAt: message.createdAt },
    });

    const mediaUrl = dto.mediaKey ? await this.storageService.getPresignedDownloadUrl(dto.mediaKey) : null;

    void this.maybeSendBotReply(thread.id, content).catch((err) =>
      this.logger.error('Failed to generate Meetday chat bot reply', err),
    );

    return { ...message, mediaUrl, wasRedacted };
  }

  // Auto-replies to every user message with an AI-generated answer, then offers to bring in a
  // human agent. Stays quiet only when an admin is the most recently active party in the thread
  // (i.e. a human has already taken over) — otherwise the bot keeps responding.
  private async maybeSendBotReply(threadId: string, userMessage: string): Promise<void> {
    if (!userMessage.trim()) return; // nothing to answer for image-only messages

    // Most recent messages, most-recent-first — index 0 is the user message we just created,
    // index 1 is whatever preceded it (if any).
    const recent = await this.prisma.meetdayChatMessage.findMany({
      where: { threadId },
      orderBy: { createdAt: 'desc' },
      take: 2,
      select: { senderType: true, content: true },
    });
    const previous = recent[1];

    if (previous?.senderType === 'ADMIN') return; // a human has taken over — stay out of the way

    if (previous?.senderType === 'BOT' && previous.content === AGENT_OFFER_MESSAGE && AFFIRMATIVE_RE.test(userMessage)) {
      await this.escalateToAdmin(threadId);
      return;
    }

    let reply: string;
    try {
      const res = await fetch(`${this.aiServerUrl}/support-chatbot/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage }),
      });
      if (!res.ok) throw new Error(`AI server returned ${res.status}`);
      const data = (await res.json()) as { reply: string };
      reply = data.reply;
    } catch (err) {
      this.logger.error(`Support chatbot reply failed: ${(err as Error).message}`);
      return; // stay silent rather than send a broken/empty bot message
    }

    // Two sequential creates (not createMany) — createMany shares one `now()` across all its
    // rows in Postgres, which made these two messages tie on createdAt and broke the "was the
    // last message the agent offer?" check above.
    await this.prisma.meetdayChatMessage.create({
      data: { threadId, senderType: 'BOT', senderId: null, content: reply },
    });
    await this.prisma.meetdayChatMessage.create({
      data: { threadId, senderType: 'BOT', senderId: null, content: AGENT_OFFER_MESSAGE },
    });
    await this.prisma.meetdayChatThread.update({
      where: { id: threadId },
      data: { lastMessageAt: new Date() },
    });
  }

  // Posts the wait-time message and pings admins so a human actually follows up.
  private async escalateToAdmin(threadId: string): Promise<void> {
    await this.prisma.meetdayChatMessage.create({
      data: { threadId, senderType: 'BOT', senderId: null, content: AGENT_WAIT_MESSAGE },
    });
    await this.prisma.meetdayChatThread.update({
      where: { id: threadId },
      data: { lastMessageAt: new Date() },
    });

    const admins = await this.prisma.user.findMany({
      where: { isActive: true, role: { name: { in: ADMIN_ROLES } } },
      select: { id: true },
    });
    const results = await Promise.allSettled(
      admins.map((admin) =>
        this.notificationsService.create(
          admin.id,
          'meetday_chat_escalation',
          'User requested a Meetday agent',
          'A user asked to speak with a Meetday agent in the support chat.',
          { meetdayChatThreadId: threadId },
        ),
      ),
    );
    results.forEach((r) => {
      if (r.status === 'rejected') this.logger.error('Failed to notify admin of Meetday chat escalation', r.reason);
    });
  }
}
