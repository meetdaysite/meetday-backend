import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { AnnouncementStatus, CommunityMemberStatus } from '@prisma/client';
import { Job } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

interface FanOutJob {
  announcementId: string;
  communityId: string;
}

const BATCH_SIZE = 500;

@Processor('community-announcements')
export class CommunityAnnouncementsProcessor {
  private readonly logger = new Logger(CommunityAnnouncementsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Process('fan-out')
  async handleFanOut(job: Job<FanOutJob>) {
    const { announcementId, communityId } = job.data;

    const announcement = await this.prisma.communityAnnouncement.findFirst({
      where: { id: announcementId, deletedAt: null },
      include: { community: { select: { name: true } } },
    });

    if (!announcement) {
      this.logger.warn(`Announcement ${announcementId} not found or deleted — skipping fan-out`);
      return;
    }

    const metadata = { communityId, announcementId, category: announcement.category };

    let cursor: string | undefined;
    let total = 0;

    // Page through active members (excluding the author) and create notifications.
    // notificationsService.create() is used per member so each recipient receives a
    // real-time socket push and their Redis unread-count cache is invalidated.
    for (;;) {
      const members = await this.prisma.communityMember.findMany({
        where: {
          communityId,
          status: CommunityMemberStatus.ACTIVE,
          userId: { not: announcement.authorId },
        },
        select: { id: true, userId: true },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });

      if (members.length === 0) break;

      await Promise.allSettled(
        members.map((m) =>
          this.notificationsService.create(
            m.userId,
            'community_announcement',
            announcement.community.name,
            announcement.title,
            metadata,
          ),
        ),
      );

      total += members.length;
      if (members.length < BATCH_SIZE) break;
      cursor = members[members.length - 1].id;
    }

    // Update reach count; if this was a scheduled announcement, mark it published now.
    await this.prisma.communityAnnouncement.update({
      where: { id: announcementId },
      data: {
        reachCount: total,
        ...(announcement.status === AnnouncementStatus.SCHEDULED
          ? { status: AnnouncementStatus.PUBLISHED, publishedAt: new Date() }
          : {}),
      },
    });

    this.logger.log(`Fan-out for announcement ${announcementId}: notified ${total} member(s)`);
  }
}
