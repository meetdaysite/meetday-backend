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
const GREETING_MESSAGE = 'Hello, welcome to Meetday Support! How can we help you today?';
const NEEDS_DETAIL_MESSAGE = 'Please describe your issue/query in detail.';
const HANDOFF_MESSAGE = 'Thank you. Your issue has been logged. An agent will revert to you within 2 hours.';
export const RESOLVED_SYSTEM_MESSAGE = '[System] The issue has been resolved.';
type Category = 'GREETING' | 'NEEDS_DETAIL' | 'DETAILED';

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

  // Runs the scripted intake flow: classifies the message as GREETING / NEEDS_DETAIL / DETAILED
  // and replies with the matching canned message. On DETAILED, logs the issue, notifies admins,
  // and goes dormant (no further auto-replies) until an admin marks the thread resolved.
  private async maybeSendBotReply(threadId: string, userMessage: string): Promise<void> {
    if (!userMessage.trim()) return; // nothing to classify for image-only messages

    const thread = await this.prisma.meetdayChatThread.findUnique({
      where: { id: threadId },
      select: { botDormant: true },
    });
    if (thread?.botDormant) return; // handed off to a human — stay silent until resolved

    let category: Category;
    try {
      const res = await fetch(`${this.aiServerUrl}/support-chatbot/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage }),
      });
      if (!res.ok) throw new Error(`AI server returned ${res.status}`);
      const data = (await res.json()) as { category: Category };
      category = data.category;
    } catch (err) {
      this.logger.error(`Support chatbot classification failed: ${(err as Error).message}`);
      return; // stay silent rather than send a broken/empty bot message
    }

    if (category === 'GREETING') {
      await this.postBotMessage(threadId, GREETING_MESSAGE);
      return;
    }

    if (category === 'NEEDS_DETAIL') {
      // Avoid looping forever if the classifier never scores a message as "detailed enough" —
      // after asking twice, just log whatever the user has said and hand off to a human.
      const trailingAsks = await this.countTrailingNeedsDetailAsks(threadId);
      if (trailingAsks >= 2) {
        await this.logAndHandOff(threadId);
        return;
      }
      await this.postBotMessage(threadId, NEEDS_DETAIL_MESSAGE);
      return;
    }

    // DETAILED — log the issue, hand off to a human, and go dormant until resolved.
    await this.logAndHandOff(threadId);
  }

  private async countTrailingNeedsDetailAsks(threadId: string): Promise<number> {
    const recentBotMessages = await this.prisma.meetdayChatMessage.findMany({
      where: { threadId, senderType: 'BOT' },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { content: true },
    });
    let count = 0;
    for (const m of recentBotMessages) {
      if (m.content !== NEEDS_DETAIL_MESSAGE) break;
      count++;
    }
    return count;
  }

  private async logAndHandOff(threadId: string): Promise<void> {
    await this.postBotMessage(threadId, HANDOFF_MESSAGE);
    await this.prisma.meetdayChatThread.update({ where: { id: threadId }, data: { botDormant: true } });
    await this.notifyAdminsOfNewIssue(threadId);
  }

  private async postBotMessage(threadId: string, content: string): Promise<void> {
    await this.prisma.meetdayChatMessage.create({
      data: { threadId, senderType: 'BOT', senderId: null, content },
    });
    await this.prisma.meetdayChatThread.update({
      where: { id: threadId },
      data: { lastMessageAt: new Date() },
    });
  }

  private async notifyAdminsOfNewIssue(threadId: string): Promise<void> {
    const admins = await this.prisma.user.findMany({
      where: { isActive: true, role: { name: { in: ADMIN_ROLES } } },
      select: { id: true },
    });
    const results = await Promise.allSettled(
      admins.map((admin) =>
        this.notificationsService.create(
          admin.id,
          'meetday_chat_escalation',
          'New support issue logged',
          "A user's issue has been logged in the Talk to Meetday chat and needs a human follow-up.",
          { meetdayChatThreadId: threadId },
        ),
      ),
    );
    results.forEach((r) => {
      if (r.status === 'rejected') this.logger.error('Failed to notify admin of Meetday chat escalation', r.reason);
    });
  }
}
