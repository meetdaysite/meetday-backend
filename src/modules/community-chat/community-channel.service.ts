import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { ReorderChannelsDto } from './dto/reorder-channels.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

@Injectable()
export class CommunityChannelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async create(communityId: string, creatorId: string, dto: CreateChannelDto) {
    const slug = toSlug(dto.name);

    const existing = await this.prisma.communityChannel.findUnique({
      where: { communityId_slug: { communityId, slug } },
      select: { id: true, deletedAt: true },
    });

    if (existing && !existing.deletedAt) {
      throw new ConflictException(`A channel with slug "${slug}" already exists in this community`);
    }

    const maxPosition = await this.prisma.communityChannel.aggregate({
      where: { communityId, deletedAt: null },
      _max: { position: true },
    });

    const channel = await this.prisma.communityChannel.create({
      data: {
        communityId,
        createdBy: creatorId,
        name: dto.name,
        slug,
        description: dto.description,
        welcomeTitle: dto.welcomeTitle,
        welcomeBody: dto.welcomeBody,
        quickReplies: dto.quickReplies ?? [],
        position: (maxPosition._max.position ?? -1) + 1,
      },
    });

    this.auditLog.log({
      actorId: creatorId,
      action: AuditAction.CHAT_CHANNEL_CREATED,
      entityType: 'CommunityChannel',
      entityId: channel.id,
      metadata: { communityId, name: channel.name },
    });

    return channel;
  }

  async list(communityId: string, requestingUserId?: string) {
    const channels = await this.prisma.communityChannel.findMany({
      where: { communityId, deletedAt: null },
      orderBy: { position: 'asc' },
    });

    if (!requestingUserId) return channels;

    const states = await this.prisma.channelMemberState.findMany({
      where: {
        channelId: { in: channels.map((c) => c.id) },
        userId: requestingUserId,
      },
      select: { channelId: true, lastReadAt: true, bannerDismissedAt: true },
    });

    const stateMap = new Map(states.map((s) => [s.channelId, s]));

    return channels.map((c) => ({
      ...c,
      memberState: stateMap.get(c.id) ?? null,
    }));
  }

  async update(channelId: string, communityId: string, dto: UpdateChannelDto) {
    const channel = await this.findOrThrow(channelId, communityId);

    if (dto.name && dto.name !== channel.name) {
      const newSlug = toSlug(dto.name);
      const conflict = await this.prisma.communityChannel.findUnique({
        where: { communityId_slug: { communityId, slug: newSlug } },
        select: { id: true, deletedAt: true },
      });
      if (conflict && conflict.id !== channelId && !conflict.deletedAt) {
        throw new ConflictException(`A channel with slug "${newSlug}" already exists`);
      }

      return this.prisma.communityChannel.update({
        where: { id: channelId },
        data: {
          name: dto.name,
          slug: newSlug,
          description: dto.description,
          welcomeTitle: dto.welcomeTitle,
          welcomeBody: dto.welcomeBody,
          quickReplies: dto.quickReplies,
        },
      });
    }

    return this.prisma.communityChannel.update({
      where: { id: channelId },
      data: {
        description: dto.description,
        welcomeTitle: dto.welcomeTitle,
        welcomeBody: dto.welcomeBody,
        quickReplies: dto.quickReplies,
      },
    });
  }

  async softDelete(channelId: string, communityId: string, actorId: string) {
    const channel = await this.findOrThrow(channelId, communityId);

    if (channel.isDefault) {
      throw new BadRequestException('Cannot delete the default General channel');
    }

    await this.prisma.communityChannel.update({
      where: { id: channelId },
      data: { deletedAt: new Date() },
    });

    this.auditLog.log({
      actorId,
      action: AuditAction.CHAT_CHANNEL_DELETED,
      entityType: 'CommunityChannel',
      entityId: channelId,
      metadata: { communityId, name: channel.name },
    });

    return { success: true };
  }

  async reorder(communityId: string, dto: ReorderChannelsDto) {
    await this.prisma.$transaction(
      dto.orderedIds.map((id, index) =>
        this.prisma.communityChannel.updateMany({
          where: { id, communityId, deletedAt: null },
          data: { position: index },
        }),
      ),
    );
  }

  private async findOrThrow(channelId: string, communityId: string) {
    const channel = await this.prisma.communityChannel.findFirst({
      where: { id: channelId, communityId, deletedAt: null },
    });
    if (!channel) throw new NotFoundException('Channel not found');
    return channel;
  }
}
