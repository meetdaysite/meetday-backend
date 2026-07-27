import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { hasEventEnded } from '../events/event-time.util';

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  async createReview(userId: string, dto: CreateReviewDto) {
    // Verify the order exists, belongs to the user, is CONFIRMED, and matches the event
    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
      select: { id: true, userId: true, eventId: true, status: true },
    });

    if (!order) throw new NotFoundException('Order not found');
    if (order.userId !== userId) throw new ForbiddenException('You do not own this order');
    if (order.eventId !== dto.eventId) throw new BadRequestException('Order does not belong to this event');
    if (order.status !== 'CONFIRMED') throw new BadRequestException('Only confirmed orders can leave a review');

    // Verify event has already taken place
    const event = await this.prisma.event.findUnique({
      where: { id: dto.eventId },
      select: {
        id: true,
        eventDate: true,
        endDate: true,
        startTime: true,
        endTime: true,
        title: true,
        categoryId: true,
        hostProfile: { select: { userId: true } },
      },
    });
    if (!event) throw new NotFoundException('Event not found');
    if (!hasEventEnded(event))
      throw new BadRequestException('You can only review an event after it has taken place');

    if (dto.highlights?.length) {
      await this.validateHighlights(dto.highlights, event.categoryId);
    }

    // Check for duplicate (unique constraint covers this, but give a clear message)
    const existing = await this.prisma.eventReview.findUnique({
      where: { userId_eventId: { userId, eventId: dto.eventId } },
      select: { id: true },
    });
    if (existing) throw new ConflictException('You have already reviewed this event');

    const review = await this.prisma.eventReview.create({
      data: {
        eventId: dto.eventId,
        userId,
        orderId: dto.orderId,
        rating: dto.rating,
        hostRating: dto.hostRating ?? null,
        hostBody: dto.hostBody ?? null,
        highlights: dto.highlights ?? [],
        body: dto.body ?? null,
        photos: dto.photoKeys?.length
          ? { create: dto.photoKeys.map((key) => ({ key })) }
          : undefined,
      },
      include: { photos: true },
    });

    void this.syncHostRating(dto.eventId);

    if (event.hostProfile?.userId) {
      void this.notifications.create(
        event.hostProfile.userId,
        'event_reviewed',
        'New review on your event',
        `Someone left a ${dto.rating}-star review on "${event.title}".`,
        { eventId: dto.eventId, reviewId: review.id },
      ).catch(() => {});
    }

    return review;
  }

  async updateReview(reviewId: string, userId: string, dto: UpdateReviewDto) {
    const review = await this.prisma.eventReview.findUnique({
      where: { id: reviewId },
      select: { id: true, userId: true, eventId: true },
    });

    if (!review) throw new NotFoundException('Review not found');
    if (review.userId !== userId) throw new ForbiddenException('You do not own this review');

    if (dto.highlights?.length) {
      const event = await this.prisma.event.findUnique({
        where: { id: review.eventId },
        select: { categoryId: true },
      });
      await this.validateHighlights(dto.highlights, event?.categoryId ?? null);
    }

    // If photoKeys provided, replace all photos
    const photosUpdate = dto.photoKeys !== undefined
      ? {
          deleteMany: {},
          create: dto.photoKeys.map((key) => ({ key })),
        }
      : undefined;

    const updated = await this.prisma.eventReview.update({
      where: { id: reviewId },
      data: {
        ...(dto.rating !== undefined && { rating: dto.rating }),
        ...(dto.hostRating !== undefined && { hostRating: dto.hostRating }),
        ...(dto.hostBody !== undefined && { hostBody: dto.hostBody }),
        ...(dto.highlights !== undefined && { highlights: dto.highlights }),
        ...(dto.body !== undefined && { body: dto.body }),
        ...(photosUpdate && { photos: photosUpdate }),
      },
      include: { photos: true },
    });

    void this.syncHostRating(review.eventId);
    return updated;
  }

  async deleteReview(reviewId: string, userId: string) {
    const review = await this.prisma.eventReview.findUnique({
      where: { id: reviewId },
      select: { id: true, userId: true, eventId: true },
    });

    if (!review) throw new NotFoundException('Review not found');
    if (review.userId !== userId) throw new ForbiddenException('You do not own this review');

    await this.prisma.eventReview.delete({ where: { id: reviewId } });
    void this.syncHostRating(review.eventId);
    return { message: 'Review deleted' };
  }

  async getMyReviews(userId: string, page = 1, limit = 20) {
    const [reviews, total] = await Promise.all([
      this.prisma.eventReview.findMany({
        where: { userId },
        include: {
          event: { select: { id: true, title: true, eventDate: true, venueName: true, city: true } },
          photos: { where: { approvalStatus: 'APPROVED' }, select: { id: true, key: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.eventReview.count({ where: { userId } }),
    ]);

    const signed = await Promise.all(
      reviews.map(async (r) => ({
        ...r,
        photos: await Promise.all(
          r.photos.map(async (p) => ({ ...p, url: await this.storageService.getPresignedDownloadUrl(p.key) })),
        ),
      })),
    );

    return { reviews: signed, total, page, limit };
  }

  async getEventReviews(eventId: string, page = 1, limit = 20) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
    if (!event) throw new NotFoundException('Event not found');

    const [reviews, total, agg, hostAgg] = await Promise.all([
      this.prisma.eventReview.findMany({
        where: { eventId, isVisible: true },
        select: {
          id: true,
          rating: true,
          hostRating: true,
          hostBody: true,
          highlights: true,
          body: true,
          createdAt: true,
          user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
          photos: {
            where: { approvalStatus: 'APPROVED' },
            select: { id: true, key: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.eventReview.count({ where: { eventId, isVisible: true } }),
      this.prisma.eventReview.aggregate({
        where: { eventId, isVisible: true },
        _avg: { rating: true },
        _count: { rating: true },
      }),
      this.prisma.eventReview.aggregate({
        where: { eventId, isVisible: true, hostRating: { not: null } },
        _avg: { hostRating: true },
      }),
    ]);

    const signed = await Promise.all(
      reviews.map(async (r) => ({
        ...r,
        photos: await Promise.all(
          r.photos.map(async (p) => ({ ...p, url: await this.storageService.getPresignedDownloadUrl(p.key) })),
        ),
      })),
    );

    return {
      reviews: signed,
      total,
      page,
      limit,
      averageRating: agg._avg.rating ? Math.round(agg._avg.rating * 10) / 10 : null,
      averageHostRating: hostAgg._avg.hostRating ? Math.round(hostAgg._avg.hostRating * 10) / 10 : null,
      reviewCount: agg._count.rating,
    };
  }

  // ─── Host: photo moderation ───────────────────────────────────────────────

  async getPendingPhotos(hostUserId: string) {
    const hostProfile = await this.prisma.hostProfile.findUnique({
      where: { userId: hostUserId },
      select: { id: true },
    });
    if (!hostProfile) throw new NotFoundException('Host profile not found');

    const photos = await this.prisma.reviewPhoto.findMany({
      where: {
        approvalStatus: 'PENDING',
        review: { event: { hostProfileId: hostProfile.id } },
      },
      include: {
        review: {
          select: {
            id: true,
            eventId: true,
            user: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return Promise.all(
      photos.map(async (p) => ({ ...p, url: await this.storageService.getPresignedDownloadUrl(p.key) })),
    );
  }

  async moderatePhoto(photoId: string, hostUserId: string, action: 'APPROVED' | 'REJECTED') {
    const photo = await this.prisma.reviewPhoto.findUnique({
      where: { id: photoId },
      include: { review: { include: { event: { select: { hostProfile: { select: { userId: true } } } } } } },
    });

    if (!photo) throw new NotFoundException('Photo not found');
    if (photo.review.event.hostProfile.userId !== hostUserId)
      throw new ForbiddenException('You do not own this event');
    if (photo.approvalStatus !== 'PENDING')
      throw new BadRequestException('Photo has already been moderated');

    const now = new Date();
    return this.prisma.reviewPhoto.update({
      where: { id: photoId },
      data: {
        approvalStatus: action,
        approvedAt: action === 'APPROVED' ? now : null,
        rejectedAt: action === 'REJECTED' ? now : null,
      },
    });
  }

  // ─── Admin: review visibility ─────────────────────────────────────────────

  async setReviewVisibility(reviewId: string, isVisible: boolean) {
    const review = await this.prisma.eventReview.findUnique({
      where: { id: reviewId },
      select: { id: true, eventId: true },
    });
    if (!review) throw new NotFoundException('Review not found');

    const updated = await this.prisma.eventReview.update({
      where: { id: reviewId },
      data: { isVisible },
    });
    void this.syncHostRating(review.eventId);
    return updated;
  }

  async listAllReviews(page = 1, limit = 20) {
    const [reviews, total] = await Promise.all([
      this.prisma.eventReview.findMany({
        include: {
          event: { select: { id: true, title: true } },
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
          photos: { select: { id: true, approvalStatus: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.eventReview.count(),
    ]);

    return { reviews, total, page, limit };
  }

  async getHighlightsForEvent(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { categoryId: true },
    });
    if (!event) throw new NotFoundException('Event not found');
    if (!event.categoryId) return [];

    return this.prisma.categoryHighlight.findMany({
      where: { categoryId: event.categoryId },
      select: { key: true, label: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  private async validateHighlights(highlights: string[], categoryId: string | null) {
    if (!categoryId) return;

    const validKeys = new Set(
      (await this.prisma.categoryHighlight.findMany({
        where: { categoryId },
        select: { key: true },
      })).map((h) => h.key),
    );

    const invalid = highlights.filter((h) => !validKeys.has(h));
    if (invalid.length) {
      throw new BadRequestException(`Invalid highlights for this event category: ${invalid.join(', ')}`);
    }
  }

  private async syncHostRating(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { hostProfileId: true },
    });
    if (!event?.hostProfileId) return;

    const agg = await this.prisma.eventReview.aggregate({
      where: {
        isVisible: true,
        hostRating: { not: null },
        event: { hostProfileId: event.hostProfileId },
      },
      _avg: { hostRating: true },
      _count: { hostRating: true },
    });

    await this.prisma.hostProfile.update({
      where: { id: event.hostProfileId },
      data: {
        averageRating: agg._avg.hostRating ?? null,
        totalReviews: agg._count.hostRating,
      },
    });
  }
}
