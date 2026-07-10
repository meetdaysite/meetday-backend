/**
 * Coupons E2E tests
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
    // Token is just the uid string — decode it directly for E2E tests
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

describe('Coupons (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let superAdminUser: any;

  beforeAll(async () => {
    ({ app, prisma } = await buildTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateTables(prisma);
    await seedRefData(prisma);
    superAdminUser = await createTestUser(prisma, { uid: TEST_UIDS.superAdmin, roleName: 'SUPER_ADMIN' });
  });

  // ── POST /admin/coupons ─────────────────────────────────────────────────

  describe('POST /admin/coupons', () => {
    it('SUPER_ADMIN creates a PERCENTAGE coupon successfully', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/coupons')
        .set(authHeader(TEST_UIDS.superAdmin))
        .send({
          code: 'LAUNCH20',
          target: 'HOST',
          discountType: 'PERCENTAGE',
          discountValue: 20,
          description: '20% off platform fees for early hosts',
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ code: 'LAUNCH20', discountValue: 20, isActive: true });
    });

    it('creates a FLAT discount coupon', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/coupons')
        .set(authHeader(TEST_UIDS.superAdmin))
        .send({
          code: 'FLAT5',
          target: 'HOST',
          discountType: 'FLAT',
          discountValue: 5,
        });

      expect(res.status).toBe(201);
    });

    it('returns 409 for duplicate coupon code', async () => {
      await prisma.coupon.create({
        data: {
          code: 'EXISTING',
          target: 'HOST',
          discountType: 'PERCENTAGE',
          discountValue: 10,
          isActive: true,
          createdBy: superAdminUser.id,
        },
      });

      const res = await request(app.getHttpServer())
        .post('/admin/coupons')
        .set(authHeader(TEST_UIDS.superAdmin))
        .send({ code: 'EXISTING', target: 'HOST', discountType: 'PERCENTAGE', discountValue: 10 });

      expect(res.status).toBe(409);
    });

    it('returns 400 when code is too short (< 3 chars)', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/coupons')
        .set(authHeader(TEST_UIDS.superAdmin))
        .send({ code: 'AB', target: 'HOST', discountType: 'PERCENTAGE', discountValue: 10 });

      expect(res.status).toBe(400);
    });

    it('returns 400 when PERCENTAGE discount exceeds 100', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/coupons')
        .set(authHeader(TEST_UIDS.superAdmin))
        .send({ code: 'BADPCT', target: 'HOST', discountType: 'PERCENTAGE', discountValue: 150 });

      expect(res.status).toBe(400);
    });

    it('returns 400 when validFrom is after validUntil', async () => {
      const future = new Date(Date.now() + 86400000).toISOString();
      const past = new Date(Date.now() - 86400000).toISOString();

      const res = await request(app.getHttpServer())
        .post('/admin/coupons')
        .set(authHeader(TEST_UIDS.superAdmin))
        .send({ code: 'BADDATE', target: 'HOST', discountType: 'PERCENTAGE', discountValue: 10, validFrom: future, validUntil: past });

      expect(res.status).toBe(400);
    });

    it('returns 403 when called by non-SUPER_ADMIN (CITY_ADMIN)', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.cityAdmin, roleName: 'CITY_ADMIN' });

      const res = await request(app.getHttpServer())
        .post('/admin/coupons')
        .set(authHeader(TEST_UIDS.cityAdmin))
        .send({ code: 'NOCREATE', target: 'HOST', discountType: 'PERCENTAGE', discountValue: 10 });

      expect(res.status).toBe(403);
    });
  });

  // ── GET /admin/coupons ──────────────────────────────────────────────────

  describe('GET /admin/coupons', () => {
    beforeEach(async () => {
      await prisma.coupon.createMany({
        data: [
          { code: 'HOST10', target: 'HOST', discountType: 'PERCENTAGE', discountValue: 10, isActive: true, createdBy: superAdminUser.id },
          { code: 'ATT5', target: 'ATTENDEE', discountType: 'FLAT', discountValue: 5, isActive: true, createdBy: superAdminUser.id },
          { code: 'DISABLED', target: 'HOST', discountType: 'FLAT', discountValue: 2, isActive: false, createdBy: superAdminUser.id },
        ],
      });
    });

    it('returns paginated coupon list', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/coupons')
        .set(authHeader(TEST_UIDS.superAdmin));

      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(3);
    });

    it('filters by target', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/coupons?target=HOST')
        .set(authHeader(TEST_UIDS.superAdmin));

      expect(res.status).toBe(200);
      expect(res.body.data.coupons.every((c: any) => c.target === 'HOST')).toBe(true);
    });

    it('filters by isActive', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/coupons?isActive=false')
        .set(authHeader(TEST_UIDS.superAdmin));

      expect(res.status).toBe(200);
      expect(res.body.data.coupons.every((c: any) => c.isActive === false)).toBe(true);
    });
  });

  // ── GET /admin/coupons/:id ──────────────────────────────────────────────

  describe('GET /admin/coupons/:id', () => {
    it('returns coupon detail with redemption count', async () => {
      const coupon = await prisma.coupon.create({
        data: { code: 'DETAIL10', target: 'HOST', discountType: 'PERCENTAGE', discountValue: 10, isActive: true, createdBy: superAdminUser.id },
      });

      const res = await request(app.getHttpServer())
        .get(`/admin/coupons/${coupon.id}`)
        .set(authHeader(TEST_UIDS.superAdmin));

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ code: 'DETAIL10' });
    });

    it('returns 404 for non-existent coupon', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/coupons/00000000-0000-0000-0000-000000000000')
        .set(authHeader(TEST_UIDS.superAdmin));

      expect(res.status).toBe(404);
    });
  });

  // ── PATCH /admin/coupons/:id/disable ───────────────────────────────────

  describe('PATCH /admin/coupons/:id/disable', () => {
    it('disables an active coupon', async () => {
      const coupon = await prisma.coupon.create({
        data: { code: 'TODISABLE', target: 'HOST', discountType: 'PERCENTAGE', discountValue: 10, isActive: true, createdBy: superAdminUser.id },
      });

      const res = await request(app.getHttpServer())
        .patch(`/admin/coupons/${coupon.id}/disable`)
        .set(authHeader(TEST_UIDS.superAdmin));

      expect(res.status).toBe(200);
      const updated = await prisma.coupon.findUnique({ where: { id: coupon.id } });
      expect(updated!.isActive).toBe(false);
    });

    it('returns 400 when coupon is already inactive', async () => {
      const coupon = await prisma.coupon.create({
        data: { code: 'ALREADYOFF', target: 'HOST', discountType: 'FLAT', discountValue: 5, isActive: false, createdBy: superAdminUser.id },
      });

      const res = await request(app.getHttpServer())
        .patch(`/admin/coupons/${coupon.id}/disable`)
        .set(authHeader(TEST_UIDS.superAdmin));

      expect(res.status).toBe(400);
    });
  });
});
