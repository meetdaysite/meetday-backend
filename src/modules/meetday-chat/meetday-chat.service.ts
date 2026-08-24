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

const AGENT_FOLLOWUP_MESSAGE = 'Our support team will get back to you within 2 hours if you need further help.';

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

  // Auto-replies with an AI-generated answer until a human admin has sent a message in this
  // thread — once an admin engages, the bot steps back permanently for that thread.
  private async maybeSendBotReply(threadId: string, userMessage: string): Promise<void> {
    if (!userMessage.trim()) return; // nothing to answer for image-only messages

    const adminReplied = await this.prisma.meetdayChatMessage.findFirst({
      where: { threadId, senderType: 'ADMIN' },
      select: { id: true },
    });
    if (adminReplied) return;

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

    await this.prisma.meetdayChatMessage.createMany({
      data: [
        { threadId, senderType: 'BOT', senderId: null, content: reply },
        { threadId, senderType: 'BOT', senderId: null, content: AGENT_FOLLOWUP_MESSAGE },
      ],
    });
    await this.prisma.meetdayChatThread.update({
      where: { id: threadId },
      data: { lastMessageAt: new Date() },
    });
  }
}
