import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EventStatus, Prisma, Visibility } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateEventDto } from './dto/create-event.dto';
import { ListMyEventsQueryDto } from './dto/list-my-events-query.dto';
import { BrowseEventsQueryDto } from './dto/browse-events-query.dto';
import { CancelEventDto } from './dto/cancel-event.dto';

const EVENT_DETAIL_INCLUDE = {
  tickets: true,
  refundPolicy: true,
  category: { select: { id: true, name: true } },
  hostProfile: { select: { id: true, displayName: true } },
};

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async withSignedMedia<T extends { media: Array<{ url: string }> }>(obj: T): Promise<T> {
    const signed = await Promise.all(
      obj.media.map(async (m) => ({ ...m, url: await this.storageService.getPresignedDownloadUrl(m.url) })),
    );
    return { ...obj, media: signed };
  }

  async createEvent(userId: string, dto: CreateEventDto) {
    const hostProfile = await this.prisma.hostProfile.findUnique({
      where: { userId },
      select: { id: true, approvalStatus: true },
    });
    if (!hostProfile) throw new NotFoundException('Host profile not found');
    if (hostProfile.approvalStatus !== 'APPROVED')
      throw new ForbiddenException('Host must be approved to create events');

    if (dto.categoryId) {
      const category = await this.prisma.category.findFirst({
        where: { id: dto.categoryId, isActive: true },
        select: { id: true },
      });
      if (!category) throw new NotFoundException('Category not found or inactive');
    }

    if (dto.isFree && dto.tickets?.some((t) => (t.price ?? 0) !== 0))
      throw new BadRequestException('All ticket prices must be 0 for a free event');

    return this.prisma.$transaction(async (tx) => {
      return tx.event.create({
        data: {
          hostProfileId: hostProfile.id,
          categoryId: dto.categoryId,
          title: dto.title,
          description: dto.description,
          eventType: dto.eventType,
          languages: dto.languages ?? [],
          tags: dto.tags ?? [],
          eventDate: dto.eventDate ? new Date(dto.eventDate) : null,
          startTime: dto.startTime,
          endTime: dto.endTime,
          venueName: dto.venueName,
          fullAddress: dto.fullAddress,
          city: dto.city,
          latitude: dto.latitude,
          longitude: dto.longitude,
          whatToExpect: dto.whatToExpect ?? [],
          whoShouldAttend: dto.whoShouldAttend ?? [],
          visibility: dto.visibility ?? Visibility.PUBLIC,
          ageRestriction: dto.ageRestriction,
          specialInstructions: dto.specialInstructions,
          isFree: dto.isFree ?? false,
          status: EventStatus.DRAFT,
          ...(dto.tickets && {
            tickets: {
              create: dto.tickets.map((t) => ({
                name: t.name as string,
                price: t.price ?? 0,
                totalCapacity: t.totalCapacity ?? 0,
                maxPerPerson: t.maxPerPerson,
                description: t.description,
                saleStartDate: t.saleStartDate ? new Date(t.saleStartDate) : null,
                saleEndDate: t.saleEndDate ? new Date(t.saleEndDate) : null,
              })),
            },
          }),
          ...(dto.refundPolicy && {
            refundPolicy: {
              create: {
                type: dto.refundPolicy.type!,
                cutoffHours: dto.refundPolicy.cutoffHours,
                refundPercent: dto.refundPolicy.refundPercent,
                refundTo: dto.refundPolicy.refundTo!,
              },
            },
          }),
          ...(dto.media && {
            media: {
              create: dto.media.map((m) => ({
                url: m.key,
                type: m.type,
                order: m.order ?? 0,
              })),
            },
          }),
        },
        include: EVENT_DETAIL_INCLUDE,
      });
    });
  }

  async updateEvent(userId: string, eventId: string, dto: CreateEventDto) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { hostProfile: { select: { userId: true } } },
    });
    if (!event) throw new NotFoundException('Event not found');
    if (event.hostProfile.userId !== userId)
      throw new ForbiddenException('You do not own this event');
    if (event.status !== EventStatus.DRAFT)
      throw new ForbiddenException('Only DRAFT events can be edited');

    if (dto.categoryId) {
      const category = await this.prisma.category.findFirst({
        where: { id: dto.categoryId, isActive: true },
        select: { id: true },
      });
      if (!category) throw new NotFoundException('Category not found or inactive');
    }

    const isFree = dto.isFree ?? (event.isFree as boolean);
    if (dto.tickets && isFree && dto.tickets.some((t) => (t.price ?? 0) !== 0))
      throw new BadRequestException('All ticket prices must be 0 for a free event');

    return this.prisma.$transaction(async (tx) => {
      await tx.event.update({
        where: { id: eventId },
        data: {
          ...(dto.categoryId !== undefined && { categoryId: dto.categoryId }),
          ...(dto.title !== undefined && { title: dto.title }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.eventType !== undefined && { eventType: dto.eventType }),
          ...(dto.languages !== undefined && { languages: dto.languages }),
          ...(dto.tags !== undefined && { tags: dto.tags }),
          ...(dto.eventDate !== undefined && { eventDate: new Date(dto.eventDate) }),
          ...(dto.startTime !== undefined && { startTime: dto.startTime }),
          ...(dto.endTime !== undefined && { endTime: dto.endTime }),
          ...(dto.venueName !== undefined && { venueName: dto.venueName }),
          ...(dto.fullAddress !== undefined && { fullAddress: dto.fullAddress }),
          ...(dto.city !== undefined && { city: dto.city }),
          ...(dto.latitude !== undefined && { latitude: dto.latitude }),
          ...(dto.longitude !== undefined && { longitude: dto.longitude }),
          ...(dto.whatToExpect !== undefined && { whatToExpect: dto.whatToExpect }),
          ...(dto.whoShouldAttend !== undefined && { whoShouldAttend: dto.whoShouldAttend }),
          ...(dto.visibility !== undefined && { visibility: dto.visibility }),
          ...(dto.ageRestriction !== undefined && { ageRestriction: dto.ageRestriction }),
          ...(dto.specialInstructions !== undefined && { specialInstructions: dto.specialInstructions }),
          ...(dto.isFree !== undefined && { isFree: dto.isFree }),
        },
      });

      if (dto.tickets !== undefined) {
        await tx.eventTicket.deleteMany({ where: { eventId } });
        if (dto.tickets.length > 0) {
          await tx.eventTicket.createMany({
            data: dto.tickets.map((t) => ({
              eventId,
              name: t.name as string,
              price: t.price ?? 0,
              totalCapacity: t.totalCapacity ?? 0,
              maxPerPerson: t.maxPerPerson,
              description: t.description,
              saleStartDate: t.saleStartDate ? new Date(t.saleStartDate) : null,
              saleEndDate: t.saleEndDate ? new Date(t.saleEndDate) : null,
            })),
          });
        }
      }

      if (dto.refundPolicy !== undefined) {
        await tx.eventRefundPolicy.upsert({
          where: { eventId },
          create: {
            eventId,
            type: dto.refundPolicy.type!,
            cutoffHours: dto.refundPolicy.cutoffHours,
            refundPercent: dto.refundPolicy.refundPercent,
            refundTo: dto.refundPolicy.refundTo!,
          },
          update: {
            ...(dto.refundPolicy.type !== undefined && { type: dto.refundPolicy.type }),
            ...(dto.refundPolicy.cutoffHours !== undefined && { cutoffHours: dto.refundPolicy.cutoffHours }),
            ...(dto.refundPolicy.refundPercent !== undefined && { refundPercent: dto.refundPolicy.refundPercent }),
            ...(dto.refundPolicy.refundTo !== undefined && { refundTo: dto.refundPolicy.refundTo }),
          },
        });
      }

      if (dto.media !== undefined) {
        await tx.eventMedia.deleteMany({ where: { eventId } });
        if (dto.media.length > 0) {
          await tx.eventMedia.createMany({
            data: dto.media.map((m) => ({
              eventId,
              url: m.key,
              type: m.type,
              order: m.order ?? 0,
            })),
          });
        }
      }

      return tx.event.findUnique({
        where: { id: eventId },
        include: EVENT_DETAIL_INCLUDE,
      });
    });
  }

  async submitEvent(userId: string, eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        hostProfile: { select: { userId: true } },
        tickets: { select: { id: true } },
        refundPolicy: { select: { id: true } },
      },
    });
    if (!event) throw new NotFoundException('Event not found');
    if (event.hostProfile.userId !== userId)
      throw new ForbiddenException('You do not own this event');
    if (event.status !== EventStatus.DRAFT)
      throw new ForbiddenException('Only DRAFT events can be submitted for review');

    const missing: string[] = [];
    if (!event.title) missing.push('title');
    if (!event.description) missing.push('description');
    if (!event.eventType) missing.push('eventType');
    if (!event.categoryId) missing.push('categoryId');
    if (!event.languages?.length) missing.push('languages');
    if (!event.eventDate) missing.push('eventDate');
    if (!event.startTime) missing.push('startTime');
    if (!event.endTime) missing.push('endTime');
    if (!event.venueName) missing.push('venueName');
    if (!event.fullAddress) missing.push('fullAddress');
    if (!(event.whatToExpect as string[])?.length) missing.push('whatToExpect');
    if (!(event.whoShouldAttend as string[])?.length) missing.push('whoShouldAttend');
    if (!event.tickets.length) missing.push('tickets');
    if (!event.refundPolicy) missing.push('refundPolicy');
    if (event.eventDate && event.eventDate <= new Date()) missing.push('eventDate (must be in the future)');

    if (missing.length)
      throw new BadRequestException(`Event is incomplete. Missing: ${missing.join(', ')}`);

    const updated = await this.prisma.event.update({
      where: { id: eventId },
      data: { status: EventStatus.UNDER_REVIEW, submittedAt: new Date() },
      include: EVENT_DETAIL_INCLUDE,
    });

    const adminRoles = ['SUPER_ADMIN', 'CITY_ADMIN', 'MODERATOR'];
    const admins = await this.prisma.user.findMany({
      where: { isActive: true, role: { name: { in: adminRoles } } },
      select: { id: true },
    });

    void Promise.all(
      admins.map((admin) =>
        this.notificationsService.create(
          admin.id,
          'event_pending_review',
          'New Event Pending Review',
          `A new event "${event.title ?? 'Untitled'}" has been submitted for review.`,
        ),
      ),
    ).catch((err) => this.logger.error('Failed to notify admins of pending event', err));

    return updated;
  }

  async getMyEvents(userId: string, query: ListMyEventsQueryDto) {
    const hostProfile = await this.prisma.hostProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!hostProfile) throw new NotFoundException('Host profile not found');

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: any = {
      hostProfileId: hostProfile.id,
      ...(query.status && { status: query.status }),
    };

    const [events, total] = await Promise.all([
      this.prisma.event.findMany({
        where,
        select: {
          id: true,
          title: true,
          status: true,
          eventDate: true,
          city: true,
          venueName: true,
          isFree: true,
          adminRejectionRemark: true,
          submittedAt: true,
          createdAt: true,
          category: { select: { id: true, name: true } },
          media: {
            where: { type: 'COVER' },
            select: { url: true },
            take: 1,
          },
          tickets: {
            select: { totalCapacity: true, price: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.event.count({ where }),
    ]);

    const enriched = await Promise.all(
      events.map(async (e) => {
        const cover = e.media[0];
        const totalCapacity = e.tickets.reduce((sum, t) => sum + t.totalCapacity, 0);
        const prices = e.tickets.map((t) => Number(t.price)).filter((p) => p > 0);
        const startingPrice = prices.length ? Math.min(...prices) : null;

        const { media: _media, tickets: _tickets, ...rest } = e;
        return {
          ...rest,
          coverImageUrl: cover
            ? await this.storageService.getPresignedDownloadUrl(cover.url)
            : null,
          totalCapacity,
          startingPrice,
        };
      }),
    );

    return { events: enriched, total, page, limit };
  }

  async getMyEventById(userId: string, eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        ...EVENT_DETAIL_INCLUDE,
        hostProfile: { select: { id: true, displayName: true, userId: true } },
        media: { orderBy: { order: 'asc' } },
      },
    });
    if (!event) throw new NotFoundException('Event not found');
    if (event.hostProfile.userId !== userId)
      throw new ForbiddenException('You do not own this event');
    return this.withSignedMedia(event);
  }

  async cancelEvent(userId: string, eventId: string, dto: CancelEventDto) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { hostProfile: { select: { userId: true } } },
    });
    if (!event) throw new NotFoundException('Event not found');
    if (event.hostProfile.userId !== userId)
      throw new ForbiddenException('You do not own this event');
    if (event.status !== EventStatus.PUBLISHED)
      throw new BadRequestException('Only PUBLISHED events can be cancelled');

    return this.prisma.event.update({
      where: { id: eventId },
      data: {
        status: EventStatus.CANCELLED,
        cancelledAt: new Date(),
        cancellationReason: dto.cancellationReason,
      },
      include: EVENT_DETAIL_INCLUDE,
    });
  }

  async browseEvents(query: BrowseEventsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sortOrder = query.sortOrder ?? 'asc';

    // Resolve interest slugs → category IDs via InterestCategory mapping
    let resolvedCategoryIds: string[] | undefined;
    if (query.interestSlugs?.length) {
      const interests = await this.prisma.interest.findMany({
        where: { slug: { in: query.interestSlugs } },
        include: { categoryMappings: { select: { categoryId: true } } },
      });
      resolvedCategoryIds = [...new Set(interests.flatMap((i) => i.categoryMappings.map((m) => m.categoryId)))];
    }

    // Union direct categoryId with interest-resolved category IDs
    const allCategoryIds = [
      ...(query.categoryId ? [query.categoryId] : []),
      ...(resolvedCategoryIds ?? []),
    ];
    const categoryFilter = allCategoryIds.length
      ? { categoryId: { in: [...new Set(allCategoryIds)] } }
      : {};

    // Default to upcoming events; respect explicit dateFrom if provided
    const dateFilter = {
      eventDate: {
        gte: query.dateFrom ? new Date(query.dateFrom) : new Date(),
        ...(query.dateTo && { lte: new Date(query.dateTo) }),
      },
    };

    const where: Prisma.EventWhereInput = {
      status: EventStatus.PUBLISHED,
      visibility: Visibility.PUBLIC,
      ...categoryFilter,
      ...dateFilter,
      ...(query.city && { city: { contains: query.city, mode: Prisma.QueryMode.insensitive } }),
      ...(query.isFree !== undefined && { isFree: query.isFree }),
      ...(query.search && { title: { contains: query.search, mode: Prisma.QueryMode.insensitive } }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orderBy: any =
      query.sortBy === 'price'
        ? { tickets: { _min: { price: sortOrder } } }
        : { eventDate: sortOrder };

    const [events, total] = await Promise.all([
      this.prisma.event.findMany({
        where,
        select: {
          id: true,
          title: true,
          eventType: true,
          eventDate: true,
          startTime: true,
          venueName: true,
          tags: true,
          category: { select: { id: true, name: true } },
          media: { where: { type: 'COVER' }, select: { url: true }, take: 1 },
          tickets: { select: { price: true } },
        },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.event.count({ where }),
    ]);

    const enriched = await Promise.all(
      events.map(async (e) => {
        const cover = e.media[0];
        const prices = e.tickets.map((t) => Number(t.price)).filter((p) => p > 0);
        const startingPrice = prices.length ? Math.min(...prices) : null;
        const { media: _media, tickets: _tickets, ...rest } = e;
        return {
          ...rest,
          coverImageUrl: cover ? await this.storageService.getPresignedDownloadUrl(cover.url) : null,
          startingPrice,
        };
      }),
    );

    return { events: enriched, total, page, limit };
  }

  async getPublicEventById(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId, status: EventStatus.PUBLISHED, visibility: Visibility.PUBLIC },
      select: {
        id: true,
        title: true,
        description: true,
        eventType: true,
        languages: true,
        tags: true,
        eventDate: true,
        startTime: true,
        endTime: true,
        venueName: true,
        fullAddress: true,
        city: true,
        latitude: true,
        longitude: true,
        whatToExpect: true,
        whoShouldAttend: true,
        vibeSummary: true,
        crowdPulse: true,
        isFree: true,
        ageRestriction: true,
        specialInstructions: true,
        category: { select: { id: true, name: true } },
        hostProfile: {
          select: {
            id: true,
            displayName: true,
            tagline: true,
            averageRating: true,
            totalReviews: true,
            totalEventsHosted: true,
          },
        },
        tickets: {
          select: {
            id: true,
            name: true,
            price: true,
            totalCapacity: true,
            maxPerPerson: true,
            description: true,
            saleStartDate: true,
            saleEndDate: true,
          },
        },
        refundPolicy: true,
        media: { orderBy: { order: 'asc' } },
      },
    });

    if (!event) throw new NotFoundException('Event not found');

    const [signedMedia, reviewAgg, recentReviews] = await Promise.all([
      Promise.all(
        event.media.map(async (m) => ({
          ...m,
          url: await this.storageService.getPresignedDownloadUrl(m.url),
        })),
      ),
      this.prisma.eventReview.aggregate({
        where: { eventId, isVisible: true },
        _avg: { rating: true },
        _count: { rating: true },
      }),
      this.prisma.eventReview.findMany({
        where: { eventId, isVisible: true },
        select: {
          id: true,
          rating: true,
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
        take: 3,
      }),
    ]);

    const signedReviews = await Promise.all(
      recentReviews.map(async (r) => ({
        ...r,
        photos: await Promise.all(
          r.photos.map(async (p) => ({
            id: p.id,
            url: await this.storageService.getPresignedDownloadUrl(p.key),
          })),
        ),
      })),
    );

    const prices = event.tickets.map((t) => Number(t.price)).filter((p) => p > 0);
    const startingPrice = prices.length ? Math.min(...prices) : null;

    const reviewSummary = {
      averageRating: reviewAgg._avg.rating ? Math.round(reviewAgg._avg.rating * 10) / 10 : null,
      reviewCount: reviewAgg._count.rating,
      recentReviews: signedReviews,
    };

    return { ...event, media: signedMedia, startingPrice, reviewSummary };
  }

  async deleteEvent(userId: string, eventId: string): Promise<void> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { hostProfile: { select: { userId: true } } },
    });
    if (!event) throw new NotFoundException('Event not found');
    if (event.hostProfile.userId !== userId)
      throw new ForbiddenException('You do not own this event');
    if (event.status !== EventStatus.DRAFT)
      throw new BadRequestException('Only DRAFT events can be deleted');

    await this.prisma.event.delete({ where: { id: eventId } });
  }

}
