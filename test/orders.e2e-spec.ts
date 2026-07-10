/**
 * Orders E2E tests
 *
 * Covers the core attendee order lifecycle:
 *   - Create order (POST /orders)
 *   - Confirm via mock payment (POST /orders/:id/mock-confirm)
 *   - View confirmed order (GET /orders/:id)
 *   - Cancel tickets (POST /orders/:id/cancel-tickets)
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

async function seedEventAndTicket(prisma: PrismaService, hostUserId: string) {
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
      title: 'E2E Orders Test Event',
      status: 'PUBLISHED',
      platformFeeWaived: true,
      eventDate: new Date('2099-12-31'),
    },
  });

  const ticket = await prisma.eventTicket.create({
    data: {
      eventId: event.id,
      name: 'General Admission',
      price: 500,
      isFree: false,
      totalCapacity: 100,
      soldCount: 0,
    },
  });

  return { hostProfile, event, ticket };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('Orders (E2E)', () => {
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

  // ── POST /orders ─────────────────────────────────────────────────────────

  describe('POST /orders', () => {
    it('creates a PENDING_PAYMENT order for an authenticated user', async () => {
      const hostUser = await createTestUser(prisma, { uid: TEST_UIDS.host, roleName: 'HOST' });
      const attendee = await createTestUser(prisma, { uid: TEST_UIDS.user, roleName: 'USER' });
      const { event, ticket } = await seedEventAndTicket(prisma, hostUser.id);

      const res = await request(app.getHttpServer())
        .post('/orders')
        .set(authHeader(TEST_UIDS.user))
        .send({
          eventId: event.id,
          items: [{ ticketId: ticket.id, quantity: 1 }],
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        status: 'PENDING_PAYMENT',
        eventId: event.id,
      });
    });

    it('returns 404 when event does not exist', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.user, roleName: 'USER' });

      const res = await request(app.getHttpServer())
        .post('/orders')
        .set(authHeader(TEST_UIDS.user))
        .send({
          eventId: '00000000-0000-4000-a000-000000000000',
          items: [{ ticketId: '00000000-0000-4000-a000-000000000001', quantity: 1 }],
        });

      expect(res.status).toBe(404);
    });

    it('returns 401 when no auth token is provided', async () => {
      const res = await request(app.getHttpServer())
        .post('/orders')
        .send({ eventId: '00000000-0000-4000-a000-000000000000', items: [] });

      expect(res.status).toBe(401);
    });
  });

  // ── POST /orders/:id/mock-confirm ─────────────────────────────────────────

  describe('POST /orders/:id/mock-confirm', () => {
    it('confirms order and allocates tickets', async () => {
      const hostUser = await createTestUser(prisma, { uid: TEST_UIDS.host, roleName: 'HOST' });
      const attendee = await createTestUser(prisma, { uid: TEST_UIDS.user, roleName: 'USER' });
      const { event, ticket } = await seedEventAndTicket(prisma, hostUser.id);

      const orderRes = await request(app.getHttpServer())
        .post('/orders')
        .set(authHeader(TEST_UIDS.user))
        .send({ eventId: event.id, items: [{ ticketId: ticket.id, quantity: 1 }] });

      const orderId = orderRes.body.data.id;

      const confirmRes = await request(app.getHttpServer())
        .post(`/orders/${orderId}/mock-confirm`)
        .set(authHeader(TEST_UIDS.user));

      expect(confirmRes.status).toBe(201);
      expect(confirmRes.body.data).toMatchObject({ status: 'CONFIRMED' });
    });
  });

  // ── GET /orders/:id ───────────────────────────────────────────────────────

  describe('GET /orders/:id', () => {
    it('returns the confirmed order with tickets', async () => {
      const hostUser = await createTestUser(prisma, { uid: TEST_UIDS.host, roleName: 'HOST' });
      const attendee = await createTestUser(prisma, { uid: TEST_UIDS.user, roleName: 'USER' });
      const { event, ticket } = await seedEventAndTicket(prisma, hostUser.id);

      const orderRes = await request(app.getHttpServer())
        .post('/orders')
        .set(authHeader(TEST_UIDS.user))
        .send({ eventId: event.id, items: [{ ticketId: ticket.id, quantity: 1 }] });

      const orderId = orderRes.body.data.id;
      await request(app.getHttpServer())
        .post(`/orders/${orderId}/mock-confirm`)
        .set(authHeader(TEST_UIDS.user));

      const getRes = await request(app.getHttpServer())
        .get(`/orders/${orderId}`)
        .set(authHeader(TEST_UIDS.user));

      expect(getRes.status).toBe(200);
      expect(getRes.body.data).toMatchObject({ id: orderId, status: 'CONFIRMED' });
    });

    it('returns 404 when order belongs to another user', async () => {
      const hostUser = await createTestUser(prisma, { uid: TEST_UIDS.host, roleName: 'HOST' });
      const attendee = await createTestUser(prisma, { uid: TEST_UIDS.user, roleName: 'USER' });
      const other = await createTestUser(prisma, { uid: TEST_UIDS.newUser, roleName: 'USER' });
      const { event, ticket } = await seedEventAndTicket(prisma, hostUser.id);

      const orderRes = await request(app.getHttpServer())
        .post('/orders')
        .set(authHeader(TEST_UIDS.user))
        .send({ eventId: event.id, items: [{ ticketId: ticket.id, quantity: 1 }] });

      const orderId = orderRes.body.data.id;

      const getRes = await request(app.getHttpServer())
        .get(`/orders/${orderId}`)
        .set(authHeader(TEST_UIDS.newUser));

      expect(getRes.status).toBe(404);
    });
  });

  // ── POST /orders/:id/cancel-tickets ──────────────────────────────────────

  describe('POST /orders/:id/cancel-tickets', () => {
    it('cancels tickets and transitions order to CANCELLED', async () => {
      const hostUser = await createTestUser(prisma, { uid: TEST_UIDS.host, roleName: 'HOST' });
      const attendee = await createTestUser(prisma, { uid: TEST_UIDS.user, roleName: 'USER' });
      const { event, ticket } = await seedEventAndTicket(prisma, hostUser.id);

      const orderRes = await request(app.getHttpServer())
        .post('/orders')
        .set(authHeader(TEST_UIDS.user))
        .send({ eventId: event.id, items: [{ ticketId: ticket.id, quantity: 1 }] });

      const orderId = orderRes.body.data.id;
      await request(app.getHttpServer())
        .post(`/orders/${orderId}/mock-confirm`)
        .set(authHeader(TEST_UIDS.user));

      // Get the order to find the orderItemId and attendeeId
      const orderData = await prisma.order.findUnique({
        where: { id: orderId },
        include: { items: { include: { attendees: true } } },
      });

      const item = orderData!.items[0];
      const attendeeRecord = item.attendees[0];

      const cancelRes = await request(app.getHttpServer())
        .post(`/orders/${orderId}/cancel-tickets`)
        .set(authHeader(TEST_UIDS.user))
        .send({
          items: [{ orderItemId: item.id, quantity: 1, attendeeIds: [attendeeRecord.id] }],
          reason: 'USER_CANCELLED',
        });

      expect(cancelRes.status).toBe(201);

      const updatedOrder = await prisma.order.findUnique({ where: { id: orderId } });
      expect(updatedOrder!.status).toBe('CANCELLED');
    });
  });
});
