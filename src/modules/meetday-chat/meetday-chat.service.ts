import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { SendChatMessageDto } from '../sponsorship/dto/send-chat-message.dto';
import { redactPersonalInfo } from '../../common/utils/redact-personal-info.util';

// General "Talk to Meetday" support chat — one thread per Host/Brand user, independent of any
// specific sponsorship interest (unlike TriChat).
@Injectable()
export class MeetdayChatService {
  private readonly logger = new Logger(MeetdayChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

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
    return { ...message, mediaUrl, wasRedacted };
  }
}
