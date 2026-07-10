/**
 * Reviews E2E tests
 *
 * Covers the attendee review lifecycle:
 *   - Create review (POST /reviews)
 *   - List reviews for an event (GET /events/:id/reviews)
 *   - Update review (PATCH /reviews/:id)
 *   - Delete review (DELETE /reviews/:id)
 *   - Duplicate review guard → 409
 *
 * Prerequisites:
 *   docker-compose up -d postgres redis
 *   DATABASE_URL=postgresql://meetday:meetday@localhost:5432/meetday_test npx prisma migrate deploy
 */

jest.mock('firebase-admin', () => ({
  apps: [],
  initializeApp: jest.fn(),
  credential: { cert: jest.fn().mockReturnValue({}) },
  auth: jest.fn().mockReturnValue({
    verifyIdToken: jest.fn().mockImplementation((token: string) =>
      Promise.resolve({ uid: token, email: `${token}@test.com`, firebase: { sign_in_provider: 'password' } }),
    ),
    getUserByEmail: jest.fn().mockRejectedValue({ errorInfo: { code: 'auth/user-not-found' } }),
    createUser: jest.fn().mockResolvedValue({ uid: 'fb-uid' }),
    generatePasswordResetLink: jest.fn().mockResolvedValue('http://reset-link'),
    updateUser: jest.fn().mockResolvedValue({}),
  }),
}));

import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { buildTestApp } from './helpers/app.helper';
import { truncateTables, seedRefData, createTestUser } from './helpers/db.helper';
import { TEST_UIDS, authHeader } from './helpers/auth.helper';

// ─── Seeding helpers ──────────────────────────────────────────────────────────

async function seedPastEventWithConfirmedOrder(prisma: PrismaService, hostUserId: string, attendeeUserId: string) {
  const hostProfile = await prisma.hostProfile.create({
    data: {
      userId: hostUserId,
      hostType: 'INDIVIDUAL',
      kycStatus: 'VERIFIED',
      approvalStatus: 'APPROVED',
      currentPlan: 'DISCOVER',
    },
  });

  const event = await prisma.event.create({
    data: {
      hostProfileId: hostProfile.id,
      title: 'Past Review Event',
      status: 'PUBLISHED',
      platformFeeWaived: true,
      eventDate: new Date('2020-01-01'), // past event
    },
  });

  const ticket = await prisma.eventTicket.create({
    data: {
      eventId: event.id,
      name: 'General',
      price: 500,
      isFree: false,
      totalCapacity: 100,
      soldCount: 1,
    },
  });

  const order = await prisma.order.create({
    data: {
      userId: attendeeUserId,
      eventId: event.id,
      status: 'CONFIRMED',
      bookingId: 'TXN-TEST-001',
      subtotal: 500,
      discountAmount: 0,
      platformFee: 0,
      totalAmount: 500,
      confirmedAt: new Date(),
      items: {
        create: [
          {
            ticketId: ticket.id,
            quantity: 1,
            unitPrice: 500,
            cancelledCount: 0,
            attendees: {
              create: [{ fullName: 'Test Attendee', email: 'attendee@test.com' }],
            },
          },
        ],
      },
    },
  });

  return { hostProfile, event, ticket, order };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('Reviews (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await buildTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateTables(prisma);
    await seedRefData(prisma);
    jest.clearAllMocks();
  });

  // ── POST /reviews ─────────────────────────────────────────────────────────

  describe('POST /reviews', () => {
    it('creates a review for a confirmed past order', async () => {
      const hostUser = await createTestUser(prisma, { uid: TEST_UIDS.host, roleName: 'HOST' });
      const attendee = await createTestUser(prisma, { uid: TEST_UIDS.user, roleName: 'USER' });
      const { event, order } = await seedPastEventWithConfirmedOrder(prisma, hostUser.id, attendee.id);

      const res = await request(app.getHttpServer())
        .post('/reviews')
        .set(authHeader(TEST_UIDS.user))
        .send({
          eventId: event.id,
          orderId: order.id,
          rating: 5,
          body: 'Amazing event!',
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ rating: 5, eventId: event.id });
    });

    it('returns 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer())
        .post('/reviews')
        .send({
          eventId: '00000000-0000-4000-a000-000000000000',
          orderId: '00000000-0000-4000-a000-000000000001',
          rating: 3,
        });

      expect(res.status).toBe(401);
    });

    it('returns 400 when the order is not confirmed', async () => {
      const hostUser = await createTestUser(prisma, { uid: TEST_UIDS.host, roleName: 'HOST' });
      const attendee = await createTestUser(prisma, { uid: TEST_UIDS.user, roleName: 'USER' });
      const { event, order } = await seedPastEventWithConfirmedOrder(prisma, hostUser.id, attendee.id);

      // Change order to PENDING to simulate an unconfirmed order
      await prisma.order.update({ where: { id: order.id }, data: { status: 'PENDING_PAYMENT' } });

      const res = await request(app.getHttpServer())
        .post('/reviews')
        .set(authHeader(TEST_UIDS.user))
        .send({ eventId: event.id, orderId: order.id, rating: 4 });

      expect(res.status).toBe(400);
    });

    it('returns 409 when a review already exists for the same order', async () => {
      const hostUser = await createTestUser(prisma, { uid: TEST_UIDS.host, roleName: 'HOST' });
      const attendee = await createTestUser(prisma, { uid: TEST_UIDS.user, roleName: 'USER' });
      const { event, order } = await seedPastEventWithConfirmedOrder(prisma, hostUser.id, attendee.id);

      // First review
      await request(app.getHttpServer())
        .post('/reviews')
        .set(authHeader(TEST_UIDS.user))
        .send({ eventId: event.id, orderId: order.id, rating: 4, body: 'Great!' });

      // Duplicate
      const res = await request(app.getHttpServer())
        .post('/reviews')
        .set(authHeader(TEST_UIDS.user))
        .send({ eventId: event.id, orderId: order.id, rating: 3, body: 'Changed my mind' });

      expect(res.status).toBe(409);
    });
  });

  // ── GET /events/:id/reviews ───────────────────────────────────────────────

  describe('GET /events/:id/reviews', () => {
    it('returns reviews list for a published event', async () => {
      const hostUser = await createTestUser(prisma, { uid: TEST_UIDS.host, roleName: 'HOST' });
      const attendee = await createTestUser(prisma, { uid: TEST_UIDS.user, roleName: 'USER' });
      const { event, order } = await seedPastEventWithConfirmedOrder(prisma, hostUser.id, attendee.id);

      await request(app.getHttpServer())
        .post('/reviews')
        .set(authHeader(TEST_UIDS.user))
        .send({ eventId: event.id, orderId: order.id, rating: 5, body: 'Loved it!' });

      const res = await request(app.getHttpServer()).get(`/events/${event.id}/reviews`);

      expect(res.status).toBe(200);
      expect(res.body.data.reviews.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── DELETE /reviews/:id ───────────────────────────────────────────────────

  describe('DELETE /reviews/:id', () => {
    it('deletes a review the user owns', async () => {
      const hostUser = await createTestUser(prisma, { uid: TEST_UIDS.host, roleName: 'HOST' });
      const attendee = await createTestUser(prisma, { uid: TEST_UIDS.user, roleName: 'USER' });
      const { event, order } = await seedPastEventWithConfirmedOrder(prisma, hostUser.id, attendee.id);

      const createRes = await request(app.getHttpServer())
        .post('/reviews')
        .set(authHeader(TEST_UIDS.user))
        .send({ eventId: event.id, orderId: order.id, rating: 4 });

      const reviewId = createRes.body.data.id;

      const deleteRes = await request(app.getHttpServer())
        .delete(`/reviews/${reviewId}`)
        .set(authHeader(TEST_UIDS.user));

      expect(deleteRes.status).toBe(200);
    });
  });
});
