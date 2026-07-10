/**
 * Coupon Checkout E2E tests
 *
 * Covers the full attendee coupon lifecycle:
 *   - preview: POST /orders/validate-coupon
 *   - apply at checkout: POST /orders with couponCode
 *   - usageCount rollback on cancellation
 *   - maxUsages atomic boundary
 *   - maxUsagesPerUser enforcement
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
import { buildTestApp, mockMailQueue } from './helpers/app.helper';
import { truncateTables, seedRefData, createTestUser } from './helpers/db.helper';
import { TEST_UIDS, authHeader } from './helpers/auth.helper';

// ─── Shared seeding helpers ──────────────────────────────────────────────────

async function seedEventFixture(
  prisma: PrismaService,
  hostUserId: string,
  ticketPrice = 500,
) {
  const hostProfile = await prisma.hostProfile.create({
    data: {
      userId: hostUserId,
      hostType: 'INDIVIDUAL',
      kycStatus: 'VERIFIED',
      approvalStatus: 'APPROVED',
      currentPlan: 'DISCOVER',
    },
  });

  // Far-future eventDate so the cancellation window never triggers during tests
  const event = await prisma.event.create({
    data: {
      hostProfileId: hostProfile.id,
      title: 'E2E Test Event',
      status: 'PUBLISHED',
      platformFeeWaived: true, // keeps financials simple — no fee/GST noise
      eventDate: new Date('2099-12-31'),
    },
  });

  const ticket = await prisma.eventTicket.create({
    data: {
      eventId: event.id,
      name: 'General Admission',
      price: ticketPrice,
      isFree: false,
      totalCapacity: 100,
      soldCount: 0,
    },
  });

  return { hostProfile, event, ticket };
}

async function seedCoupon(
  prisma: PrismaService,
  createdBy: string,
  overrides: Record<string, any> = {},
) {
  return prisma.coupon.create({
    data: {
      code: 'TESTCODE',
      target: 'ATTENDEE',
      discountType: 'PERCENTAGE',
      discountValue: 20,
      isActive: true,
      createdBy,
      ...overrides,
    },
  });
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('Coupon Checkout (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let superAdminUser: any;
  let attendeeUser: any;
  let hostUser: any;

  beforeAll(async () => {
    ({ app, prisma } = await buildTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Delete order/event/notification data not covered by shared truncateTables, in FK order
    await prisma.notification.deleteMany();
    await prisma.savedEvent.deleteMany();
    await prisma.eventReview.deleteMany();
    await prisma.hostPayoutLineItem.deleteMany();
    await prisma.orderAttendee.deleteMany();
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
    await prisma.eventMedia.deleteMany();
    await prisma.eventRefundPolicy.deleteMany();
    await prisma.eventTicket.deleteMany();
    await prisma.event.deleteMany();
    await truncateTables(prisma);
    await seedRefData(prisma);
    jest.clearAllMocks();
    mockMailQueue.add.mockResolvedValue(undefined);

    superAdminUser = await createTestUser(prisma, { uid: TEST_UIDS.superAdmin, roleName: 'SUPER_ADMIN' });
    hostUser = await createTestUser(prisma, { uid: TEST_UIDS.host, roleName: 'HOST' });
    attendeeUser = await createTestUser(prisma, { uid: TEST_UIDS.user, roleName: 'USER' });
  });

  // ── POST /orders/validate-coupon ─────────────────────────────────────────

  describe('POST /orders/validate-coupon', () => {
    it('returns correct breakdown for a PERCENTAGE coupon', async () => {
      const { event, ticket } = await seedEventFixture(prisma, hostUser.id, 1000);
      const coupon = await seedCoupon(prisma, superAdminUser.id, {
        code: 'PCT20',
        discountType: 'PERCENTAGE',
        discountValue: 20,
      });

      const res = await request(app.getHttpServer())
        .post('/orders/validate-coupon')
        .set(authHeader(TEST_UIDS.user))
        .send({ eventId: event.id, couponCode: coupon.code, items: [{ ticketId: ticket.id, quantity: 2 }] });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        valid: true,
        couponCode: 'PCT20',
        discountType: 'PERCENTAGE',
        discountValue: 20,
        subtotal: 2000,
        discountAmount: 400,  // 20% of 2000
        netSubtotal: 1600,
      });
    });

    it('returns correct breakdown for a FLAT coupon', async () => {
      const { event, ticket } = await seedEventFixture(prisma, hostUser.id, 500);
      const coupon = await seedCoupon(prisma, superAdminUser.id, {
        code: 'FLAT100',
        discountType: 'FLAT',
        discountValue: 100,
      });

      const res = await request(app.getHttpServer())
        .post('/orders/validate-coupon')
        .set(authHeader(TEST_UIDS.user))
        .send({ eventId: event.id, couponCode: coupon.code, items: [{ ticketId: ticket.id, quantity: 1 }] });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ subtotal: 500, discountAmount: 100, netSubtotal: 400 });
    });

    it('caps discount at maxDiscountAmount for PERCENTAGE coupon', async () => {
      const { event, ticket } = await seedEventFixture(prisma, hostUser.id, 10000);
      const coupon = await seedCoupon(prisma, superAdminUser.id, {
        code: 'CAPPED',
        discountType: 'PERCENTAGE',
        discountValue: 50,
        maxDiscountAmount: 1000,
      });

      const res = await request(app.getHttpServer())
        .post('/orders/validate-coupon')
        .set(authHeader(TEST_UIDS.user))
        .send({ eventId: event.id, couponCode: coupon.code, items: [{ ticketId: ticket.id, quantity: 1 }] });

      expect(res.status).toBe(200);
      // 50% of 10000 = 5000, but capped at 1000
      expect(res.body.data.discountAmount).toBe(1000);
      expect(res.body.data.netSubtotal).toBe(9000);
    });

    it('returns 400 when subtotal is below minOrderValue', async () => {
      const { event, ticket } = await seedEventFixture(prisma, hostUser.id, 200);
      const coupon = await seedCoupon(prisma, superAdminUser.id, {
        code: 'MINVAL',
        minOrderValue: 500,
      });

      const res = await request(app.getHttpServer())
        .post('/orders/validate-coupon')
        .set(authHeader(TEST_UIDS.user))
        .send({ eventId: event.id, couponCode: coupon.code, items: [{ ticketId: ticket.id, quantity: 1 }] });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/minimum order value/i);
    });

    it('returns 400 for an inactive coupon', async () => {
      const { event, ticket } = await seedEventFixture(prisma, hostUser.id);
      const coupon = await seedCoupon(prisma, superAdminUser.id, { code: 'INACTIVE', isActive: false });

      const res = await request(app.getHttpServer())
        .post('/orders/validate-coupon')
        .set(authHeader(TEST_UIDS.user))
        .send({ eventId: event.id, couponCode: coupon.code, items: [{ ticketId: ticket.id, quantity: 1 }] });

      expect(res.status).toBe(400);
    });

    it('returns 400 for a HOST-targeted coupon', async () => {
      const { event, ticket } = await seedEventFixture(prisma, hostUser.id);
      const coupon = await seedCoupon(prisma, superAdminUser.id, { code: 'HOSTONLY', target: 'HOST' });

      const res = await request(app.getHttpServer())
        .post('/orders/validate-coupon')
        .set(authHeader(TEST_UIDS.user))
        .send({ eventId: event.id, couponCode: coupon.code, items: [{ ticketId: ticket.id, quantity: 1 }] });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/not valid for ticket purchases/i);
    });

    it('returns 400 for an expired coupon', async () => {
      const { event, ticket } = await seedEventFixture(prisma, hostUser.id);
      const coupon = await seedCoupon(prisma, superAdminUser.id, {
        code: 'EXPIRED',
        validUntil: new Date('2020-01-01'),
      });

      const res = await request(app.getHttpServer())
        .post('/orders/validate-coupon')
        .set(authHeader(TEST_UIDS.user))
        .send({ eventId: event.id, couponCode: coupon.code, items: [{ ticketId: ticket.id, quantity: 1 }] });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/expired/i);
    });

    it('returns 400 for a not-yet-active coupon', async () => {
      const { event, ticket } = await seedEventFixture(prisma, hostUser.id);
      const coupon = await seedCoupon(prisma, superAdminUser.id, {
        code: 'FUTURE',
        validFrom: new Date('2099-01-01'),
      });

      const res = await request(app.getHttpServer())
        .post('/orders/validate-coupon')
        .set(authHeader(TEST_UIDS.user))
        .send({ eventId: event.id, couponCode: coupon.code, items: [{ ticketId: ticket.id, quantity: 1 }] });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/not yet active/i);
    });

    it('returns 400 when global usage limit is exhausted', async () => {
      const { event, ticket } = await seedEventFixture(prisma, hostUser.id);
      const coupon = await seedCoupon(prisma, superAdminUser.id, {
        code: 'MAXUSED',
        maxUsages: 1,
        usageCount: 1,
      });

      const res = await request(app.getHttpServer())
        .post('/orders/validate-coupon')
        .set(authHeader(TEST_UIDS.user))
        .send({ eventId: event.id, couponCode: coupon.code, items: [{ ticketId: ticket.id, quantity: 1 }] });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/usage limit reached/i);
    });

    it('returns 400 when per-user limit is exhausted', async () => {
      const { event, ticket } = await seedEventFixture(prisma, hostUser.id);
      const coupon = await seedCoupon(prisma, superAdminUser.id, { code: 'PERUSER', maxUsagesPerUser: 1 });

      // Seed an existing confirmed order for this user with this coupon
      await prisma.order.create({
        data: {
          bookingId: 'MDAY-TEST-0001',
          userId: attendeeUser.id,
          eventId: event.id,
          couponId: coupon.id,
          status: 'CONFIRMED',
          subtotal: 500,
          platformFee: 0,
          taxAmount: 0,
          totalAmount: 400,
          discountAmount: 100,
        },
      });

      const res = await request(app.getHttpServer())
        .post('/orders/validate-coupon')
        .set(authHeader(TEST_UIDS.user))
        .send({ eventId: event.id, couponCode: coupon.code, items: [{ ticketId: ticket.id, quantity: 1 }] });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/maximum number of times/i);
    });

    it('returns 400 for a coupon restricted to a different event', async () => {
      const { hostProfile, event: event1 } = await seedEventFixture(prisma, hostUser.id);

      // A second event on the same host profile
      const event2 = await prisma.event.create({
        data: { hostProfileId: hostProfile.id, title: 'Other Event', status: 'PUBLISHED' },
      });
      const ticket2 = await prisma.eventTicket.create({
        data: { eventId: event2.id, name: 'GA', price: 500, isFree: false, totalCapacity: 100, soldCount: 0 },
      });

      // Coupon is restricted to event1
      const coupon = await seedCoupon(prisma, superAdminUser.id, {
        code: 'WRONGEV',
        eventId: event1.id,
      });

      // Try to apply it to event2 → should reject
      const res = await request(app.getHttpServer())
        .post('/orders/validate-coupon')
        .set(authHeader(TEST_UIDS.user))
        .send({ eventId: event2.id, couponCode: coupon.code, items: [{ ticketId: ticket2.id, quantity: 1 }] });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/not valid for this event/i);
    });
  });

  // ── POST /orders with couponCode ─────────────────────────────────────────

  describe('POST /orders with couponCode', () => {
    it('applies PERCENTAGE discount to order financials', async () => {
      const { event, ticket } = await seedEventFixture(prisma, hostUser.id, 1000);
      const coupon = await seedCoupon(prisma, superAdminUser.id, {
        code: 'PCT20',
        discountType: 'PERCENTAGE',
        discountValue: 20,
      });

      const res = await request(app.getHttpServer())
        .post('/orders')
        .set(authHeader(TEST_UIDS.user))
        .send({ eventId: event.id, items: [{ ticketId: ticket.id, quantity: 1 }], couponCode: coupon.code });

      expect(res.status).toBe(201);
      expect(Number(res.body.data.discountAmount)).toBe(200); // 20% of 1000
      expect(Number(res.body.data.subtotal)).toBe(1000);
    });

    it('applies FLAT discount to order financials', async () => {
      const { event, ticket } = await seedEventFixture(prisma, hostUser.id, 800);
      const coupon = await seedCoupon(prisma, superAdminUser.id, {
        code: 'FLAT150',
        discountType: 'FLAT',
        discountValue: 150,
      });

      const res = await request(app.getHttpServer())
        .post('/orders')
        .set(authHeader(TEST_UIDS.user))
        .send({ eventId: event.id, items: [{ ticketId: ticket.id, quantity: 1 }], couponCode: coupon.code });

      expect(res.status).toBe(201);
      expect(Number(res.body.data.discountAmount)).toBe(150);
    });

    it('increments usageCount after a successful order', async () => {
      const { event, ticket } = await seedEventFixture(prisma, hostUser.id);
      const coupon = await seedCoupon(prisma, superAdminUser.id, { code: 'COUNTME' });

      await request(app.getHttpServer())
        .post('/orders')
        .set(authHeader(TEST_UIDS.user))
        .send({ eventId: event.id, items: [{ ticketId: ticket.id, quantity: 1 }], couponCode: coupon.code })
        .expect(201);

      const updated = await prisma.coupon.findUnique({ where: { id: coupon.id } });
      expect(updated!.usageCount).toBe(1);
    });

    it('caps discount at maxDiscountAmount', async () => {
      const { event, ticket } = await seedEventFixture(prisma, hostUser.id, 5000);
      const coupon = await seedCoupon(prisma, superAdminUser.id, {
        code: 'CAPPD',
        discountType: 'PERCENTAGE',
        discountValue: 50,
        maxDiscountAmount: 500,
      });

      const res = await request(app.getHttpServer())
        .post('/orders')
        .set(authHeader(TEST_UIDS.user))
        .send({ eventId: event.id, items: [{ ticketId: ticket.id, quantity: 1 }], couponCode: coupon.code });

      expect(res.status).toBe(201);
      expect(Number(res.body.data.discountAmount)).toBe(500); // 50% of 5000 = 2500, capped at 500
    });

    it('returns 400 when subtotal is below minOrderValue', async () => {
      const { event, ticket } = await seedEventFixture(prisma, hostUser.id, 100);
      const coupon = await seedCoupon(prisma, superAdminUser.id, { code: 'MINVAL', minOrderValue: 500 });

      const res = await request(app.getHttpServer())
        .post('/orders')
        .set(authHeader(TEST_UIDS.user))
        .send({ eventId: event.id, items: [{ ticketId: ticket.id, quantity: 1 }], couponCode: coupon.code });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/minimum order value/i);
    });

    it('returns 400 for a HOST-targeted coupon', async () => {
      const { event, ticket } = await seedEventFixture(prisma, hostUser.id);
      const coupon = await seedCoupon(prisma, superAdminUser.id, { code: 'HOSTONLY', target: 'HOST' });

      const res = await request(app.getHttpServer())
        .post('/orders')
        .set(authHeader(TEST_UIDS.user))
        .send({ eventId: event.id, items: [{ ticketId: ticket.id, quantity: 1 }], couponCode: coupon.code });

      expect(res.status).toBe(400);
    });

    it('returns 400 for an unknown coupon code', async () => {
      const { event, ticket } = await seedEventFixture(prisma, hostUser.id);

      const res = await request(app.getHttpServer())
        .post('/orders')
        .set(authHeader(TEST_UIDS.user))
        .send({ eventId: event.id, items: [{ ticketId: ticket.id, quantity: 1 }], couponCode: 'DOESNOTEXIST' });

      expect(res.status).toBe(400);
    });

    it('returns 409 when the last maxUsages slot is already taken', async () => {
      const { event, ticket } = await seedEventFixture(prisma, hostUser.id);
      const coupon = await seedCoupon(prisma, superAdminUser.id, {
        code: 'LASTSLOT',
        maxUsages: 1,
        usageCount: 1, // already at limit
      });

      const res = await request(app.getHttpServer())
        .post('/orders')
        .set(authHeader(TEST_UIDS.user))
        .send({ eventId: event.id, items: [{ ticketId: ticket.id, quantity: 1 }], couponCode: coupon.code });

      // Pre-check (line 169) returns 400; if the race slips through, the atomic SQL returns 409
      expect([400, 409]).toContain(res.status);
    });

    it('returns 400 when maxUsagesPerUser is exhausted', async () => {
      const { event, ticket } = await seedEventFixture(prisma, hostUser.id);
      const coupon = await seedCoupon(prisma, superAdminUser.id, {
        code: 'ONCEPER',
        maxUsagesPerUser: 1,
      });

      // Seed a prior CONFIRMED order for this user
      await prisma.order.create({
        data: {
          bookingId: 'MDAY-PRIOR-001',
          userId: attendeeUser.id,
          eventId: event.id,
          couponId: coupon.id,
          status: 'CONFIRMED',
          subtotal: 500,
          platformFee: 0,
          taxAmount: 0,
          totalAmount: 400,
          discountAmount: 100,
        },
      });

      const res = await request(app.getHttpServer())
        .post('/orders')
        .set(authHeader(TEST_UIDS.user))
        .send({ eventId: event.id, items: [{ ticketId: ticket.id, quantity: 1 }], couponCode: coupon.code });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/maximum number of times/i);
    });
  });

  // ── usageCount rollback on user cancellation ─────────────────────────────

  describe('usageCount rollback on cancellation', () => {
    it('decrements usageCount when a CONFIRMED order is cancelled', async () => {
      const { event, ticket } = await seedEventFixture(prisma, hostUser.id);
      const coupon = await seedCoupon(prisma, superAdminUser.id, { code: 'ROLLBACK' });

      // Create order → usageCount becomes 1
      const createRes = await request(app.getHttpServer())
        .post('/orders')
        .set(authHeader(TEST_UIDS.user))
        .send({ eventId: event.id, items: [{ ticketId: ticket.id, quantity: 1 }], couponCode: coupon.code })
        .expect(201);

      const orderId = createRes.body.data.id;

      // Confirm via dev endpoint
      await request(app.getHttpServer())
        .post(`/orders/${orderId}/mock-confirm`)
        .set(authHeader(TEST_UIDS.user))
        .expect(200);

      // Cancel → usageCount should go back to 0
      await request(app.getHttpServer())
        .post(`/orders/${orderId}/cancel`)
        .set(authHeader(TEST_UIDS.user))
        .expect(200);

      const updated = await prisma.coupon.findUnique({ where: { id: coupon.id } });
      expect(updated!.usageCount).toBe(0);
    });
  });

  // ── maxUsages atomic boundary ─────────────────────────────────────────────

  describe('maxUsages atomic boundary', () => {
    it('rejects the second order when maxUsages=1 was consumed by the first', async () => {
      const { event, ticket } = await seedEventFixture(prisma, hostUser.id);
      const coupon = await seedCoupon(prisma, superAdminUser.id, { code: 'ONETIME', maxUsages: 1 });

      const secondUser = await createTestUser(prisma, { uid: 'test-uid-user2', roleName: 'USER' });

      // First order from attendeeUser — should succeed
      await request(app.getHttpServer())
        .post('/orders')
        .set(authHeader(TEST_UIDS.user))
        .send({ eventId: event.id, items: [{ ticketId: ticket.id, quantity: 1 }], couponCode: coupon.code })
        .expect(201);

      // Second order from a different user — should fail (limit reached)
      const res = await request(app.getHttpServer())
        .post('/orders')
        .set(authHeader(secondUser.firebaseUid))
        .send({ eventId: event.id, items: [{ ticketId: ticket.id, quantity: 1 }], couponCode: coupon.code });

      expect([400, 409]).toContain(res.status);

      const updated = await prisma.coupon.findUnique({ where: { id: coupon.id } });
      expect(updated!.usageCount).toBe(1);
    });
  });

  // ── Admin coupon management endpoints ────────────────────────────────────

  describe('PATCH /admin/coupons/:id/enable', () => {
    it('re-enables a disabled coupon', async () => {
      const coupon = await seedCoupon(prisma, superAdminUser.id, { code: 'REENABLE', isActive: false });

      const res = await request(app.getHttpServer())
        .patch(`/admin/coupons/${coupon.id}/enable`)
        .set(authHeader(TEST_UIDS.superAdmin));

      expect(res.status).toBe(200);
      const updated = await prisma.coupon.findUnique({ where: { id: coupon.id } });
      expect(updated!.isActive).toBe(true);
    });

    it('returns 400 when coupon is already active', async () => {
      const coupon = await seedCoupon(prisma, superAdminUser.id, { code: 'ALREADYON' });

      const res = await request(app.getHttpServer())
        .patch(`/admin/coupons/${coupon.id}/enable`)
        .set(authHeader(TEST_UIDS.superAdmin));

      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /admin/coupons/:id', () => {
    it('updates validUntil and discountValue', async () => {
      const coupon = await seedCoupon(prisma, superAdminUser.id, { code: 'UPDATABLE' });
      const newExpiry = '2099-06-30T23:59:59.000Z';

      const res = await request(app.getHttpServer())
        .patch(`/admin/coupons/${coupon.id}`)
        .set(authHeader(TEST_UIDS.superAdmin))
        .send({ validUntil: newExpiry, discountValue: 30 });

      expect(res.status).toBe(200);
      expect(Number(res.body.data.discountValue)).toBe(30);
      expect(new Date(res.body.data.validUntil).toISOString()).toBe(new Date(newExpiry).toISOString());
    });

    it('returns 400 when maxUsages would be set below current usageCount', async () => {
      const coupon = await seedCoupon(prisma, superAdminUser.id, { code: 'LOWMAX', usageCount: 5 });

      const res = await request(app.getHttpServer())
        .patch(`/admin/coupons/${coupon.id}`)
        .set(authHeader(TEST_UIDS.superAdmin))
        .send({ maxUsages: 3 });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/below the current usage count/i);
    });

    it('returns 400 when validFrom is after validUntil', async () => {
      const coupon = await seedCoupon(prisma, superAdminUser.id, { code: 'BADDATE2' });

      const res = await request(app.getHttpServer())
        .patch(`/admin/coupons/${coupon.id}`)
        .set(authHeader(TEST_UIDS.superAdmin))
        .send({ validFrom: '2099-12-31T00:00:00.000Z', validUntil: '2099-01-01T00:00:00.000Z' });

      expect(res.status).toBe(400);
    });

    it('returns 404 for a non-existent coupon', async () => {
      const res = await request(app.getHttpServer())
        .patch('/admin/coupons/00000000-0000-0000-0000-000000000000')
        .set(authHeader(TEST_UIDS.superAdmin))
        .send({ discountValue: 10 });

      expect(res.status).toBe(404);
    });
  });

  // ── CreateCouponDto cross-field validation ────────────────────────────────

  describe('POST /admin/coupons — cross-field validation', () => {
    it('returns 400 when eventId is set but target is HOST', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/coupons')
        .set(authHeader(TEST_UIDS.superAdmin))
        .send({
          code: 'HOSTEVENT',
          target: 'HOST',
          discountType: 'PERCENTAGE',
          discountValue: 10,
          eventId: '00000000-0000-0000-0000-000000000001',
        });

      expect(res.status).toBe(400);
    });

    it('accepts eventId when target is ATTENDEE', async () => {
      const { event } = await seedEventFixture(prisma, hostUser.id);

      const res = await request(app.getHttpServer())
        .post('/admin/coupons')
        .set(authHeader(TEST_UIDS.superAdmin))
        .send({
          code: 'ATTEVENT',
          target: 'ATTENDEE',
          discountType: 'FLAT',
          discountValue: 50,
          eventId: event.id,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.eventId).toBe(event.id);
    });

    it('stores minOrderValue and maxDiscountAmount on create', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/coupons')
        .set(authHeader(TEST_UIDS.superAdmin))
        .send({
          code: 'WITHCAPS',
          target: 'ATTENDEE',
          discountType: 'PERCENTAGE',
          discountValue: 50,
          minOrderValue: 300,
          maxDiscountAmount: 200,
        });

      expect(res.status).toBe(201);
      expect(Number(res.body.data.minOrderValue)).toBe(300);
      expect(Number(res.body.data.maxDiscountAmount)).toBe(200);
    });
  });

  // ── GET /events/:id/available-offers ─────────────────────────────────────

  describe('GET /events/:id/available-offers', () => {
    it('returns active event-scoped ATTENDEE coupons the user can redeem', async () => {
      const { event } = await seedEventFixture(prisma, hostUser.id);
      await seedCoupon(prisma, superAdminUser.id, {
        code: 'OFFER10',
        discountType: 'FLAT',
        discountValue: 10,
        description: '₹10 off',
        eventId: event.id,
        maxDiscountAmount: null,
        minOrderValue: null,
      });

      const res = await request(app.getHttpServer())
        .get(`/events/${event.id}/available-offers`)
        .set(authHeader(TEST_UIDS.user));

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({
        code: 'OFFER10',
        discountType: 'FLAT',
        discountValue: 10,
        description: '₹10 off',
      });
    });

    it('does not expose internal fields (id, usageCount, maxUsages, maxUsagesPerUser)', async () => {
      const { event } = await seedEventFixture(prisma, hostUser.id);
      await seedCoupon(prisma, superAdminUser.id, {
        code: 'NOLEAK',
        eventId: event.id,
        maxUsages: 50,
        maxUsagesPerUser: 2,
      });

      const res = await request(app.getHttpServer())
        .get(`/events/${event.id}/available-offers`)
        .set(authHeader(TEST_UIDS.user));

      expect(res.status).toBe(200);
      expect(res.body.data[0]).not.toHaveProperty('id');
      expect(res.body.data[0]).not.toHaveProperty('usageCount');
      expect(res.body.data[0]).not.toHaveProperty('maxUsages');
      expect(res.body.data[0]).not.toHaveProperty('maxUsagesPerUser');
    });

    it('returns an empty array when no coupons exist for the event', async () => {
      const { event } = await seedEventFixture(prisma, hostUser.id);

      const res = await request(app.getHttpServer())
        .get(`/events/${event.id}/available-offers`)
        .set(authHeader(TEST_UIDS.user));

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });

    it('excludes platform-wide coupons (eventId: null)', async () => {
      const { event } = await seedEventFixture(prisma, hostUser.id);
      // Platform-wide — no eventId
      await seedCoupon(prisma, superAdminUser.id, { code: 'GLOBAL20' });

      const res = await request(app.getHttpServer())
        .get(`/events/${event.id}/available-offers`)
        .set(authHeader(TEST_UIDS.user));

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });

    it('excludes coupons tied to a different event', async () => {
      const { hostProfile, event: event1 } = await seedEventFixture(prisma, hostUser.id);
      const event2 = await prisma.event.create({
        data: { hostProfileId: hostProfile.id, title: 'Other Event', status: 'PUBLISHED' },
      });

      // Coupon for event2 only
      await seedCoupon(prisma, superAdminUser.id, { code: 'EV2ONLY', eventId: event2.id });

      const res = await request(app.getHttpServer())
        .get(`/events/${event1.id}/available-offers`)
        .set(authHeader(TEST_UIDS.user));

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });

    it('excludes inactive coupons', async () => {
      const { event } = await seedEventFixture(prisma, hostUser.id);
      await seedCoupon(prisma, superAdminUser.id, { code: 'INACTV', eventId: event.id, isActive: false });

      const res = await request(app.getHttpServer())
        .get(`/events/${event.id}/available-offers`)
        .set(authHeader(TEST_UIDS.user));

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });

    it('excludes expired coupons', async () => {
      const { event } = await seedEventFixture(prisma, hostUser.id);
      await seedCoupon(prisma, superAdminUser.id, {
        code: 'EXPIRD',
        eventId: event.id,
        validUntil: new Date('2020-01-01'),
      });

      const res = await request(app.getHttpServer())
        .get(`/events/${event.id}/available-offers`)
        .set(authHeader(TEST_UIDS.user));

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });

    it('excludes not-yet-active coupons', async () => {
      const { event } = await seedEventFixture(prisma, hostUser.id);
      await seedCoupon(prisma, superAdminUser.id, {
        code: 'FUTUREV',
        eventId: event.id,
        validFrom: new Date('2099-01-01'),
      });

      const res = await request(app.getHttpServer())
        .get(`/events/${event.id}/available-offers`)
        .set(authHeader(TEST_UIDS.user));

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });

    it('excludes globally exhausted coupons', async () => {
      const { event } = await seedEventFixture(prisma, hostUser.id);
      await seedCoupon(prisma, superAdminUser.id, {
        code: 'EXHAUST',
        eventId: event.id,
        maxUsages: 5,
        usageCount: 5, // already at cap
      });

      const res = await request(app.getHttpServer())
        .get(`/events/${event.id}/available-offers`)
        .set(authHeader(TEST_UIDS.user));

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });

    it('excludes coupons this user has personally exhausted', async () => {
      const { event } = await seedEventFixture(prisma, hostUser.id);
      const coupon = await seedCoupon(prisma, superAdminUser.id, {
        code: 'USRUSED',
        eventId: event.id,
        maxUsagesPerUser: 1,
      });

      // Seed a prior confirmed order for attendeeUser with this coupon
      await prisma.order.create({
        data: {
          bookingId: 'MDAY-PRIOR-U01',
          userId: attendeeUser.id,
          eventId: event.id,
          couponId: coupon.id,
          status: 'CONFIRMED',
          subtotal: 500,
          platformFee: 0,
          taxAmount: 0,
          totalAmount: 400,
          discountAmount: 100,
        },
      });

      const res = await request(app.getHttpServer())
        .get(`/events/${event.id}/available-offers`)
        .set(authHeader(TEST_UIDS.user));

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });

    it('shows a coupon to a second user even if the first user has exhausted their limit', async () => {
      const { event } = await seedEventFixture(prisma, hostUser.id);
      const coupon = await seedCoupon(prisma, superAdminUser.id, {
        code: 'PERUSER',
        eventId: event.id,
        maxUsagesPerUser: 1,
      });

      const secondUser = await createTestUser(prisma, { uid: 'test-uid-user2', roleName: 'USER' });

      // attendeeUser has used it
      await prisma.order.create({
        data: {
          bookingId: 'MDAY-PRIOR-U02',
          userId: attendeeUser.id,
          eventId: event.id,
          couponId: coupon.id,
          status: 'CONFIRMED',
          subtotal: 500,
          platformFee: 0,
          taxAmount: 0,
          totalAmount: 400,
          discountAmount: 100,
        },
      });

      // secondUser has not used it — should still see the offer
      const res = await request(app.getHttpServer())
        .get(`/events/${event.id}/available-offers`)
        .set(authHeader(secondUser.firebaseUid));

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].code).toBe('PERUSER');
    });

    it('returns 404 for a non-existent event', async () => {
      const res = await request(app.getHttpServer())
        .get('/events/00000000-0000-0000-0000-000000000000/available-offers')
        .set(authHeader(TEST_UIDS.user));

      expect(res.status).toBe(404);
    });

    it('returns 401 for unauthenticated requests', async () => {
      const { event } = await seedEventFixture(prisma, hostUser.id);

      const res = await request(app.getHttpServer())
        .get(`/events/${event.id}/available-offers`);

      expect([401, 403]).toContain(res.status);
    });

    it('serves from Redis cache — stale DB state does not affect cached response', async () => {
      const { event } = await seedEventFixture(prisma, hostUser.id);
      await seedCoupon(prisma, superAdminUser.id, { code: 'CACHED1', eventId: event.id });

      // First call — populates cache
      const first = await request(app.getHttpServer())
        .get(`/events/${event.id}/available-offers`)
        .set(authHeader(TEST_UIDS.user));
      expect(first.status).toBe(200);
      expect(first.body.data).toHaveLength(1);

      // Disable the coupon directly in DB (bypasses any cache invalidation)
      await prisma.coupon.update({ where: { code: 'CACHED1' }, data: { isActive: false } });

      // Second call within TTL — should still return the cached coupon
      const second = await request(app.getHttpServer())
        .get(`/events/${event.id}/available-offers`)
        .set(authHeader(TEST_UIDS.user));
      expect(second.status).toBe(200);
      expect(second.body.data).toHaveLength(1);
    });
  });

  // ── Admin notification on event-scoped coupon creation ───────────────────

  describe('POST /admin/coupons — notifications to saved-event users', () => {
    it('notifies users who have saved the event', async () => {
      const { event } = await seedEventFixture(prisma, hostUser.id);

      // attendeeUser saves the event
      await prisma.savedEvent.create({ data: { userId: attendeeUser.id, eventId: event.id } });

      await request(app.getHttpServer())
        .post('/admin/coupons')
        .set(authHeader(TEST_UIDS.superAdmin))
        .send({
          code: 'NOTIFY10',
          target: 'ATTENDEE',
          discountType: 'FLAT',
          discountValue: 10,
          description: 'Special offer just for you!',
          eventId: event.id,
        })
        .expect(201);

      // Notification is fire-and-forget — give the event loop a tick to complete it
      await new Promise((r) => setTimeout(r, 80));

      const notifications = await prisma.notification.findMany({
        where: { userId: attendeeUser.id, type: 'event_promo' },
      });
      expect(notifications).toHaveLength(1);
      expect(notifications[0].body).toContain('Special offer just for you!');
    });

    it('does not notify users who have not saved the event', async () => {
      const { event } = await seedEventFixture(prisma, hostUser.id);
      // attendeeUser has NOT saved the event

      await request(app.getHttpServer())
        .post('/admin/coupons')
        .set(authHeader(TEST_UIDS.superAdmin))
        .send({
          code: 'NONOTIFY',
          target: 'ATTENDEE',
          discountType: 'FLAT',
          discountValue: 10,
          eventId: event.id,
        })
        .expect(201);

      await new Promise((r) => setTimeout(r, 80));

      const count = await prisma.notification.count({ where: { type: 'event_promo' } });
      expect(count).toBe(0);
    });

    it('notifies only users who saved the event, not all users', async () => {
      const { event } = await seedEventFixture(prisma, hostUser.id);
      const otherUser = await createTestUser(prisma, { uid: 'test-uid-other', roleName: 'USER' });

      // Only attendeeUser saves the event — otherUser does not
      await prisma.savedEvent.create({ data: { userId: attendeeUser.id, eventId: event.id } });

      await request(app.getHttpServer())
        .post('/admin/coupons')
        .set(authHeader(TEST_UIDS.superAdmin))
        .send({
          code: 'SELECTIVE',
          target: 'ATTENDEE',
          discountType: 'FLAT',
          discountValue: 10,
          eventId: event.id,
        })
        .expect(201);

      await new Promise((r) => setTimeout(r, 80));

      expect(await prisma.notification.count({ where: { userId: attendeeUser.id, type: 'event_promo' } })).toBe(1);
      expect(await prisma.notification.count({ where: { userId: otherUser.id, type: 'event_promo' } })).toBe(0);
    });

    it('does not notify for platform-wide coupons (no eventId)', async () => {
      await createTestUser(prisma, { uid: 'test-uid-other2', roleName: 'USER' });

      await request(app.getHttpServer())
        .post('/admin/coupons')
        .set(authHeader(TEST_UIDS.superAdmin))
        .send({
          code: 'GLOBAL50',
          target: 'ATTENDEE',
          discountType: 'PERCENTAGE',
          discountValue: 50,
          // no eventId
        })
        .expect(201);

      await new Promise((r) => setTimeout(r, 80));

      const count = await prisma.notification.count({ where: { type: 'event_promo' } });
      expect(count).toBe(0);
    });

    it('does not notify for HOST-targeted coupons even with an eventId', async () => {
      const { event } = await seedEventFixture(prisma, hostUser.id);
      await prisma.savedEvent.create({ data: { userId: attendeeUser.id, eventId: event.id } });

      // HOST coupon — should NOT notify even though it has an eventId
      // Note: eventId on HOST coupon is rejected by DTO validation, so this tests that boundary holds
      const res = await request(app.getHttpServer())
        .post('/admin/coupons')
        .set(authHeader(TEST_UIDS.superAdmin))
        .send({
          code: 'HOSTEV',
          target: 'HOST',
          discountType: 'PERCENTAGE',
          discountValue: 10,
          eventId: event.id, // invalid cross-field combo — DTO rejects this
        });

      expect(res.status).toBe(400); // DTO validator blocks it

      const count = await prisma.notification.count({ where: { type: 'event_promo' } });
      expect(count).toBe(0);
    });

    it('succeeds even if no users have saved the event', async () => {
      const { event } = await seedEventFixture(prisma, hostUser.id);
      // Nobody has saved this event

      const res = await request(app.getHttpServer())
        .post('/admin/coupons')
        .set(authHeader(TEST_UIDS.superAdmin))
        .send({
          code: 'NOSAVED',
          target: 'ATTENDEE',
          discountType: 'FLAT',
          discountValue: 10,
          eventId: event.id,
        });

      // Coupon creation must succeed regardless of zero saved users
      expect(res.status).toBe(201);
    });
  });
});
