import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePrisma() {
  const prisma: any = {
    order: { findUnique: jest.fn() },
    event: { findUnique: jest.fn() },
    eventReview: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    categoryHighlight: { findMany: jest.fn() },
    reviewPhoto: { findMany: jest.fn(), update: jest.fn() },
    hostProfile: { findUnique: jest.fn(), update: jest.fn() },
  };
  return prisma;
}

const mockStorage = { getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://cdn.example.com/photo') };

// ── Fixtures ──────────────────────────────────────────────────────────────────

const userId = 'user-uuid';
const eventId = 'event-uuid';
const orderId = 'order-uuid';
const reviewId = 'review-uuid';

const confirmedOrder = { id: orderId, userId, eventId, status: 'CONFIRMED' };
const pastEvent = { id: eventId, eventDate: new Date(Date.now() - 86400_000), title: 'Past Event', categoryId: null };

// ── Test suite ────────────────────────────────────────────────────────────────

describe('ReviewsService', () => {
  let service: ReviewsService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();

    const module = await Test.createTestingModule({
      providers: [
        ReviewsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: mockStorage },
      ],
    }).compile();

    service = module.get(ReviewsService);
    jest.clearAllMocks();

    // Default aggregate stubs for syncHostRating side-effect
    prisma.eventReview.aggregate.mockResolvedValue({ _avg: { rating: null, hostRating: null }, _count: { rating: 0, hostRating: 0 } });
    prisma.event.findUnique.mockResolvedValue({ ...pastEvent, hostProfileId: 'hp-uuid' });
    prisma.hostProfile.update.mockResolvedValue({});
  });

  // ── createReview ──────────────────────────────────────────────────────────

  describe('createReview()', () => {
    const dto: any = { orderId, eventId, rating: 4 };

    beforeEach(() => {
      prisma.order.findUnique.mockResolvedValue(confirmedOrder);
      prisma.event.findUnique.mockResolvedValue(pastEvent);
      prisma.eventReview.findUnique.mockResolvedValue(null);
      prisma.eventReview.create.mockResolvedValue({ id: reviewId, rating: 4, photos: [] });
    });

    it('creates and returns the review', async () => {
      const result = await service.createReview(userId, dto);
      expect(prisma.eventReview.create).toHaveBeenCalled();
      expect(result).toMatchObject({ id: reviewId });
    });

    it('throws NotFoundException when order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null);
      await expect(service.createReview(userId, dto)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when user does not own the order', async () => {
      prisma.order.findUnique.mockResolvedValue({ ...confirmedOrder, userId: 'other' });
      await expect(service.createReview(userId, dto)).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when order does not belong to the event', async () => {
      prisma.order.findUnique.mockResolvedValue({ ...confirmedOrder, eventId: 'other-event' });
      await expect(service.createReview(userId, dto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when order is not CONFIRMED', async () => {
      prisma.order.findUnique.mockResolvedValue({ ...confirmedOrder, status: 'PENDING_PAYMENT' });
      await expect(service.createReview(userId, dto)).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when event does not exist', async () => {
      prisma.event.findUnique.mockResolvedValue(null);
      await expect(service.createReview(userId, dto)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when event has not yet taken place', async () => {
      prisma.event.findUnique.mockResolvedValue({ ...pastEvent, eventDate: new Date(Date.now() + 86400_000) });
      await expect(service.createReview(userId, dto)).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when user already reviewed the event', async () => {
      prisma.eventReview.findUnique.mockResolvedValue({ id: 'existing-review' });
      await expect(service.createReview(userId, dto)).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException for invalid highlight keys', async () => {
      prisma.event.findUnique.mockResolvedValue({ ...pastEvent, categoryId: 'cat-uuid' });
      prisma.categoryHighlight.findMany.mockResolvedValue([{ key: 'GREAT_MUSIC' }]);
      await expect(
        service.createReview(userId, { ...dto, highlights: ['INVALID_KEY'] }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── updateReview ──────────────────────────────────────────────────────────

  describe('updateReview()', () => {
    const dto: any = { rating: 5 };
    const reviewRecord = { id: reviewId, userId, eventId };

    beforeEach(() => {
      prisma.eventReview.findUnique.mockResolvedValue(reviewRecord);
      prisma.eventReview.update.mockResolvedValue({ ...reviewRecord, rating: 5, photos: [] });
    });

    it('updates the review', async () => {
      const result = await service.updateReview(reviewId, userId, dto);
      expect(prisma.eventReview.update).toHaveBeenCalled();
      expect(result).toMatchObject({ rating: 5 });
    });

    it('throws NotFoundException when review does not exist', async () => {
      prisma.eventReview.findUnique.mockResolvedValue(null);
      await expect(service.updateReview(reviewId, userId, dto)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when user does not own the review', async () => {
      prisma.eventReview.findUnique.mockResolvedValue({ ...reviewRecord, userId: 'other' });
      await expect(service.updateReview(reviewId, userId, dto)).rejects.toThrow(ForbiddenException);
    });

    it('validates highlights when provided', async () => {
      prisma.event.findUnique.mockResolvedValue({ ...pastEvent, categoryId: 'cat-uuid' });
      prisma.categoryHighlight.findMany.mockResolvedValue([{ key: 'GREAT_MUSIC' }]);
      prisma.eventReview.update.mockResolvedValue({ ...reviewRecord, highlights: ['GREAT_MUSIC'], photos: [] });

      await service.updateReview(reviewId, userId, { highlights: ['GREAT_MUSIC'] } as any);
      expect(prisma.categoryHighlight.findMany).toHaveBeenCalled();
    });

    it('throws BadRequestException for invalid highlights on update', async () => {
      prisma.event.findUnique.mockResolvedValue({ ...pastEvent, categoryId: 'cat-uuid' });
      prisma.categoryHighlight.findMany.mockResolvedValue([{ key: 'GREAT_MUSIC' }]);

      await expect(service.updateReview(reviewId, userId, { highlights: ['INVALID'] } as any)).rejects.toThrow(BadRequestException);
    });

    it('replaces photos when photoKeys are provided', async () => {
      prisma.eventReview.update.mockResolvedValue({ ...reviewRecord, photos: [{ id: 'p-1', key: 'photos/new.jpg' }] });

      await service.updateReview(reviewId, userId, { photoKeys: ['photos/new.jpg'] } as any);
      expect(prisma.eventReview.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ photos: expect.objectContaining({ deleteMany: {} }) }) }),
      );
    });
  });

  // ── deleteReview ──────────────────────────────────────────────────────────

  describe('deleteReview()', () => {
    const reviewRecord = { id: reviewId, userId, eventId };

    beforeEach(() => {
      prisma.eventReview.findUnique.mockResolvedValue(reviewRecord);
      prisma.eventReview.delete.mockResolvedValue(undefined);
    });

    it('deletes the review and returns message', async () => {
      const result = await service.deleteReview(reviewId, userId);
      expect(prisma.eventReview.delete).toHaveBeenCalledWith({ where: { id: reviewId } });
      expect(result).toEqual({ message: 'Review deleted' });
    });

    it('throws NotFoundException when review does not exist', async () => {
      prisma.eventReview.findUnique.mockResolvedValue(null);
      await expect(service.deleteReview(reviewId, userId)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when user does not own the review', async () => {
      prisma.eventReview.findUnique.mockResolvedValue({ ...reviewRecord, userId: 'other' });
      await expect(service.deleteReview(reviewId, userId)).rejects.toThrow(ForbiddenException);
    });
  });

  // ── getEventReviews ───────────────────────────────────────────────────────

  describe('getEventReviews()', () => {
    beforeEach(() => {
      prisma.event.findUnique.mockResolvedValue(pastEvent);
      prisma.eventReview.findMany.mockResolvedValue([]);
      prisma.eventReview.count.mockResolvedValue(0);
      prisma.eventReview.aggregate.mockResolvedValue({ _avg: { rating: null, hostRating: null }, _count: { rating: 0 } });
    });

    it('throws NotFoundException when event does not exist', async () => {
      prisma.event.findUnique.mockResolvedValue(null);
      await expect(service.getEventReviews('bad-event-id')).rejects.toThrow(NotFoundException);
    });

    it('returns paginated reviews with aggregated ratings', async () => {
      prisma.eventReview.aggregate.mockResolvedValueOnce({
        _avg: { rating: 4.2 },
        _count: { rating: 5 },
      }).mockResolvedValueOnce({ _avg: { hostRating: 4.0 } });

      const result = await service.getEventReviews(eventId);
      expect(result).toMatchObject({ total: 0, page: 1, limit: 20 });
    });

    it('signs photo URLs in review results', async () => {
      const reviewWithPhoto = {
        id: reviewId, rating: 4, hostRating: null, hostBody: null, highlights: [], body: 'Great!', createdAt: new Date(),
        user: { id: userId, firstName: 'Riya', lastName: 'Sen', avatarUrl: null },
        photos: [{ id: 'p-1', key: 'photos/img.jpg' }],
      };
      prisma.eventReview.findMany.mockResolvedValue([reviewWithPhoto]);
      prisma.eventReview.count.mockResolvedValue(1);
      prisma.eventReview.aggregate
        .mockResolvedValueOnce({ _avg: { rating: 4.0 }, _count: { rating: 1 } })
        .mockResolvedValueOnce({ _avg: { hostRating: null } });
      mockStorage.getPresignedDownloadUrl.mockResolvedValue('https://cdn.example.com/photo');

      const result = await service.getEventReviews(eventId);
      expect(result.reviews[0].photos[0].url).toBe('https://cdn.example.com/photo');
    });
  });

  // ── getMyReviews ──────────────────────────────────────────────────────────

  describe('getMyReviews()', () => {
    it('returns signed reviews with photos', async () => {
      const reviewWithPhoto = {
        id: reviewId,
        event: { id: eventId, title: 'Past Event', eventDate: new Date(), venueName: 'Venue', city: 'Mumbai' },
        photos: [{ id: 'p-1', key: 'photos/img.jpg' }],
      };
      prisma.eventReview.findMany.mockResolvedValue([reviewWithPhoto]);
      prisma.eventReview.count.mockResolvedValue(1);
      mockStorage.getPresignedDownloadUrl.mockResolvedValue('https://cdn.example.com/photo');

      const result = await service.getMyReviews(userId);
      expect(result.total).toBe(1);
      expect(result.reviews[0].photos[0].url).toBe('https://cdn.example.com/photo');
    });

    it('returns empty list when user has no reviews', async () => {
      prisma.eventReview.findMany.mockResolvedValue([]);
      prisma.eventReview.count.mockResolvedValue(0);

      const result = await service.getMyReviews(userId);
      expect(result).toEqual({ reviews: [], total: 0, page: 1, limit: 20 });
    });
  });

  // ── moderatePhoto ─────────────────────────────────────────────────────────

  describe('moderatePhoto()', () => {
    const photoRecord = {
      id: 'photo-uuid',
      approvalStatus: 'PENDING',
      key: 'photos/img.jpg',
      review: {
        event: { hostProfile: { userId: 'host-uuid' } },
      },
    };

    beforeEach(() => {
      prisma.reviewPhoto.findUnique = jest.fn().mockResolvedValue(photoRecord);
      prisma.reviewPhoto.update.mockResolvedValue({ ...photoRecord, approvalStatus: 'APPROVED' });
    });

    it('approves a pending photo', async () => {
      const result = await service.moderatePhoto('photo-uuid', 'host-uuid', 'APPROVED');
      expect(prisma.reviewPhoto.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ approvalStatus: 'APPROVED' }) }),
      );
    });

    it('throws NotFoundException when photo does not exist', async () => {
      prisma.reviewPhoto.findUnique.mockResolvedValue(null);
      await expect(service.moderatePhoto('bad-id', 'host-uuid', 'APPROVED')).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when host does not own the event', async () => {
      prisma.reviewPhoto.findUnique.mockResolvedValue({
        ...photoRecord,
        review: { event: { hostProfile: { userId: 'different-host' } } },
      });
      await expect(service.moderatePhoto('photo-uuid', 'host-uuid', 'APPROVED')).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when photo is already moderated', async () => {
      prisma.reviewPhoto.findUnique.mockResolvedValue({ ...photoRecord, approvalStatus: 'APPROVED' });
      await expect(service.moderatePhoto('photo-uuid', 'host-uuid', 'REJECTED')).rejects.toThrow(BadRequestException);
    });
  });

  // ── getPendingPhotos ──────────────────────────────────────────────────────

  describe('getPendingPhotos()', () => {
    it('returns pending photos with signed URLs', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue({ id: 'hp-uuid' });
      prisma.reviewPhoto.findMany.mockResolvedValue([
        { id: 'p-1', key: 'photos/img.jpg', review: { id: reviewId, eventId, user: { id: userId, firstName: 'Riya', lastName: 'Sen' } } },
      ]);
      mockStorage.getPresignedDownloadUrl.mockResolvedValue('https://cdn.example.com/photo');

      const result = await service.getPendingPhotos('host-uuid');
      expect(result).toHaveLength(1);
      expect(result[0].url).toBe('https://cdn.example.com/photo');
    });

    it('throws NotFoundException when host profile does not exist', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue(null);
      await expect(service.getPendingPhotos('unknown-host')).rejects.toThrow(NotFoundException);
    });
  });

  // ── setReviewVisibility ───────────────────────────────────────────────────

  describe('setReviewVisibility()', () => {
    beforeEach(() => {
      prisma.eventReview.findUnique.mockResolvedValue({ id: reviewId, eventId });
      prisma.eventReview.update.mockResolvedValue({ id: reviewId, isVisible: true });
    });

    it('sets review visibility to true', async () => {
      await service.setReviewVisibility(reviewId, true);
      expect(prisma.eventReview.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isVisible: true } }),
      );
    });

    it('sets review visibility to false', async () => {
      prisma.eventReview.update.mockResolvedValue({ id: reviewId, isVisible: false });
      await service.setReviewVisibility(reviewId, false);
      expect(prisma.eventReview.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isVisible: false } }),
      );
    });

    it('throws NotFoundException when review does not exist', async () => {
      prisma.eventReview.findUnique.mockResolvedValue(null);
      await expect(service.setReviewVisibility(reviewId, true)).rejects.toThrow(NotFoundException);
    });
  });

  // ── listAllReviews ────────────────────────────────────────────────────────

  describe('listAllReviews()', () => {
    it('returns paginated list of all reviews', async () => {
      const reviews = [{ id: reviewId, event: { id: eventId, title: 'Past Event' }, user: { id: userId }, photos: [] }];
      prisma.eventReview.findMany.mockResolvedValue(reviews);
      prisma.eventReview.count.mockResolvedValue(1);

      const result = await service.listAllReviews();
      expect(result).toEqual({ reviews, total: 1, page: 1, limit: 20 });
    });
  });

  // ── getHighlightsForEvent ─────────────────────────────────────────────────

  describe('getHighlightsForEvent()', () => {
    it('returns empty array when event has no category', async () => {
      prisma.event.findUnique.mockResolvedValue({ categoryId: null });
      const result = await service.getHighlightsForEvent(eventId);
      expect(result).toEqual([]);
    });

    it('throws NotFoundException when event does not exist', async () => {
      prisma.event.findUnique.mockResolvedValue(null);
      await expect(service.getHighlightsForEvent('bad-id')).rejects.toThrow(NotFoundException);
    });

    it('returns highlights for the event category', async () => {
      prisma.event.findUnique.mockResolvedValue({ categoryId: 'cat-uuid' });
      prisma.categoryHighlight.findMany.mockResolvedValue([{ key: 'GREAT_MUSIC', label: 'Great Music' }]);
      const result = await service.getHighlightsForEvent(eventId);
      expect(result).toEqual([{ key: 'GREAT_MUSIC', label: 'Great Music' }]);
    });
  });
});
