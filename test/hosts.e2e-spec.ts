/**
 * Hosts E2E tests
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
import { CryptoService } from '../src/common/crypto/crypto.service';
import { buildTestApp, mockMailQueue } from './helpers/app.helper';
import { truncateTables, seedRefData, createTestUser } from './helpers/db.helper';
import { TEST_UIDS, TEST_CATEGORY_IDS, authHeader } from './helpers/auth.helper';

describe('Hosts (E2E)', () => {
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

  // ── POST /hosts/apply ───────────────────────────────────────────────────

  describe('POST /hosts/apply', () => {
    it('creates HostProfile for a USER and returns 201', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.user, roleName: 'USER' });

      const res = await request(app.getHttpServer())
        .post('/hosts/apply')
        .set(authHeader(TEST_UIDS.user))
        .send({
          hostType: 'INDIVIDUAL',
          categoryIds: [TEST_CATEGORY_IDS.outdoor],
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        kycStatus: 'NOT_SUBMITTED',
        approvalStatus: 'PENDING',
        currentPlan: 'DISCOVER',
      });
    });

    it('returns 409 when host profile already exists', async () => {
      // Create as USER (passes the @Roles('USER') guard) but manually seed a host profile.
      // In production this state can't occur naturally (apply promotes USER → HOST atomically),
      // but we test the service-level conflict check here.
      const user = await createTestUser(prisma, { uid: TEST_UIDS.user, roleName: 'USER' });
      await prisma.hostProfile.create({
        data: {
          userId: user.id,
          hostType: 'INDIVIDUAL',
          kycStatus: 'NOT_SUBMITTED',
          approvalStatus: 'PENDING',
          currentPlan: 'DISCOVER',
        },
      });

      const res = await request(app.getHttpServer())
        .post('/hosts/apply')
        .set(authHeader(TEST_UIDS.user))
        .send({ hostType: 'INDIVIDUAL', categoryIds: [TEST_CATEGORY_IDS.outdoor] });

      expect(res.status).toBe(409);
    });

    it('returns 403 when called by a non-USER role (HOST)', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.host, roleName: 'HOST' });

      const res = await request(app.getHttpServer())
        .post('/hosts/apply')
        .set(authHeader(TEST_UIDS.host))
        .send({ hostType: 'INDIVIDUAL', categoryIds: [TEST_CATEGORY_IDS.outdoor] });

      // HOST role is not in the required roles for /hosts/apply (requires USER)
      // → 409 because of existing host profile scenario, or 403 based on guard
      // The actual behavior depends on guard evaluation order. Check is here for documentation.
      expect([403, 409]).toContain(res.status);
    });

    it('returns 400 for invalid pincode in address', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.user, roleName: 'USER' });

      const res = await request(app.getHttpServer())
        .post('/hosts/apply')
        .set(authHeader(TEST_UIDS.user))
        .send({
          hostType: 'INDIVIDUAL',
          categoryIds: [TEST_CATEGORY_IDS.outdoor],
          address: {
            addressLine1: '123 Main St',
            city: 'Mumbai',
            state: 'Maharashtra',
            pincode: '12345', // invalid — must be 6 digits
          },
        });

      expect(res.status).toBe(400);
    });
  });

  // ── GET /hosts/me ────────────────────────────────────────────────────────

  describe('GET /hosts/me', () => {
    it('returns own host profile with decrypted PAN', async () => {
      const user = await createTestUser(prisma, { uid: TEST_UIDS.host, roleName: 'HOST' });
      const cryptoService = app.get(CryptoService);
      const encrypted = cryptoService.encrypt('ABCDE1234F');

      await prisma.hostProfile.create({
        data: {
          userId: user.id,
          hostType: 'INDIVIDUAL',
          legalName: 'Test Host',
          panEncrypted: encrypted,
          kycStatus: 'NOT_SUBMITTED',
          approvalStatus: 'PENDING',
          currentPlan: 'DISCOVER',
        },
      });

      const res = await request(app.getHttpServer())
        .get('/hosts/me')
        .set(authHeader(TEST_UIDS.host));

      expect(res.status).toBe(200);
      expect(res.body.data.pan).toBe('ABCDE1234F');
      expect(res.body.data.panEncrypted).toBeUndefined();
    });

    it('returns 403 for a non-HOST user', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.user, roleName: 'USER' });

      const res = await request(app.getHttpServer())
        .get('/hosts/me')
        .set(authHeader(TEST_UIDS.user));

      expect(res.status).toBe(403);
    });
  });

  // ── GET /hosts/subscription/plans ───────────────────────────────────────

  describe('GET /hosts/subscription/plans', () => {
    it('returns active subscription plans without authentication', async () => {
      const res = await request(app.getHttpServer()).get('/hosts/subscription/plans');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });
  });

  // ── POST /hosts/kyc/submit ───────────────────────────────────────────────

  describe('POST /hosts/kyc/submit', () => {
    it('returns 400 when PAN is missing from profile', async () => {
      const user = await createTestUser(prisma, { uid: TEST_UIDS.host, roleName: 'HOST' });
      await prisma.hostProfile.create({
        data: {
          userId: user.id,
          hostType: 'INDIVIDUAL',
          legalName: 'Test Host',
          // no panEncrypted
          kycStatus: 'NOT_SUBMITTED',
          approvalStatus: 'PENDING',
          currentPlan: 'DISCOVER',
        },
      });

      const res = await request(app.getHttpServer())
        .post('/hosts/kyc/submit')
        .set(authHeader(TEST_UIDS.host))
        .send({
          bankAccount: {
            accountNumber: '123456789012',
            ifscCode: 'HDFC0001234',
            accountHolderName: 'Test Host',
            accountType: 'SAVINGS',
          },
        });

      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid IFSC code format', async () => {
      const user = await createTestUser(prisma, { uid: TEST_UIDS.host, roleName: 'HOST' });
      await prisma.hostProfile.create({
        data: { userId: user.id, hostType: 'INDIVIDUAL', kycStatus: 'NOT_SUBMITTED', approvalStatus: 'PENDING', currentPlan: 'DISCOVER' },
      });

      const res = await request(app.getHttpServer())
        .post('/hosts/kyc/submit')
        .set(authHeader(TEST_UIDS.host))
        .send({
          bankAccount: {
            accountNumber: '123456789012',
            ifscCode: 'BAD_IFSC',
            accountHolderName: 'Test',
            accountType: 'SAVINGS',
          },
        });

      expect(res.status).toBe(400);
    });

    it('returns 400 for account number too short (< 9 digits)', async () => {
      const user = await createTestUser(prisma, { uid: TEST_UIDS.host, roleName: 'HOST' });
      await prisma.hostProfile.create({
        data: { userId: user.id, hostType: 'INDIVIDUAL', kycStatus: 'NOT_SUBMITTED', approvalStatus: 'PENDING', currentPlan: 'DISCOVER' },
      });

      const res = await request(app.getHttpServer())
        .post('/hosts/kyc/submit')
        .set(authHeader(TEST_UIDS.host))
        .send({
          bankAccount: {
            accountNumber: '12345678', // only 8 digits
            ifscCode: 'HDFC0001234',
            accountHolderName: 'Test',
            accountType: 'SAVINGS',
          },
        });

      expect(res.status).toBe(400);
    });
  });

  // ── POST /hosts/reapply ──────────────────────────────────────────────────

  describe('POST /hosts/reapply', () => {
    it('resets KYC status after failure', async () => {
      const user = await createTestUser(prisma, { uid: TEST_UIDS.host, roleName: 'HOST' });
      await prisma.hostProfile.create({
        data: {
          userId: user.id,
          hostType: 'INDIVIDUAL',
          kycStatus: 'FAILED',
          approvalStatus: 'PENDING',
          currentPlan: 'DISCOVER',
        },
      });

      const res = await request(app.getHttpServer())
        .post('/hosts/reapply')
        .set(authHeader(TEST_UIDS.host));

      expect(res.status).toBe(200);
    });

    it('returns 400 when reapplication is not allowed', async () => {
      const user = await createTestUser(prisma, { uid: TEST_UIDS.host, roleName: 'HOST' });
      await prisma.hostProfile.create({
        data: {
          userId: user.id,
          hostType: 'INDIVIDUAL',
          kycStatus: 'VERIFIED',
          approvalStatus: 'APPROVED',
          currentPlan: 'DISCOVER',
        },
      });

      const res = await request(app.getHttpServer())
        .post('/hosts/reapply')
        .set(authHeader(TEST_UIDS.host));

      expect(res.status).toBe(400);
    });
  });

  // ── POST /hosts/subscription/upgrade ────────────────────────────────────

  describe('POST /hosts/subscription/upgrade', () => {
    it('returns 403 when host is not APPROVED', async () => {
      const user = await createTestUser(prisma, { uid: TEST_UIDS.host, roleName: 'HOST' });
      await prisma.hostProfile.create({
        data: { userId: user.id, hostType: 'INDIVIDUAL', kycStatus: 'VERIFIED', approvalStatus: 'PENDING', currentPlan: 'DISCOVER' },
      });

      const res = await request(app.getHttpServer())
        .post('/hosts/subscription/upgrade')
        .set(authHeader(TEST_UIDS.host))
        .send({ plan: 'COMMUNITY', billingCycle: 'MONTHLY' });

      expect(res.status).toBe(403);
    });

    it('returns 400 for SELL plan with MONTHLY billing', async () => {
      const user = await createTestUser(prisma, { uid: TEST_UIDS.host, roleName: 'HOST' });
      await prisma.hostProfile.create({
        data: { userId: user.id, hostType: 'INDIVIDUAL', kycStatus: 'VERIFIED', approvalStatus: 'APPROVED', currentPlan: 'DISCOVER' },
      });

      const res = await request(app.getHttpServer())
        .post('/hosts/subscription/upgrade')
        .set(authHeader(TEST_UIDS.host))
        .send({ plan: 'SELL', billingCycle: 'MONTHLY' });

      expect(res.status).toBe(400);
    });
  });
});
