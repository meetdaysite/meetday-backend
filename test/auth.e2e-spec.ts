/**
 * Auth E2E tests
 *
 * Prerequisites:
 *   docker-compose up -d postgres redis
 *   DATABASE_URL=postgresql://meetday:meetday@localhost:5432/meetday_test npx prisma migrate deploy
 */

// Mock firebase-admin before any module is loaded
jest.mock('firebase-admin', () => ({
  apps: [],
  initializeApp: jest.fn(),
  credential: { cert: jest.fn().mockReturnValue({}) },
  auth: jest.fn().mockReturnValue({
    // Token is the uid string. UIDs prefixed with "phone:" simulate phone-OTP
    // sign-ups where the Firebase token carries no email.
    verifyIdToken: jest.fn().mockImplementation((token: string) =>
      token.startsWith('phone:')
        ? Promise.resolve({ uid: token, phone_number: '+919876543210', firebase: { sign_in_provider: 'phone' } })
        : Promise.resolve({ uid: token, email: `${token}@test.com`, firebase: { sign_in_provider: 'password' } }),
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
import { TEST_UIDS, TEST_CATEGORY_IDS, authHeader } from './helpers/auth.helper';

describe('Auth (E2E)', () => {
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
  });

  // ── POST /auth/register ─────────────────────────────────────────────────

  describe('POST /auth/register', () => {
    it('registers a new USER and returns 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .set(authHeader(TEST_UIDS.newUser))
        .send({ firstName: 'Rahul', lastName: 'Sharma', accountType: 'USER' });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        firstName: 'Rahul',
        lastName: 'Sharma',
        role: { name: 'USER' },
        isActive: true,
      });
    });

    it('registers a new HOST with hostProfile and returns 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .set(authHeader(TEST_UIDS.newHost))
        .send({
          firstName: 'Priya',
          lastName: 'Nair',
          accountType: 'HOST',
          hostType: 'INDIVIDUAL',
          categoryIds: [TEST_CATEGORY_IDS.outdoor],
          legalName: 'Priya Nair',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.role).toMatchObject({ name: 'HOST' });
      expect(res.body.data.hostProfile).toMatchObject({
        kycStatus: 'NOT_SUBMITTED',
        approvalStatus: 'PENDING',
        currentPlan: 'DISCOVER',
      });
    });

    it('registers a HOST via phone-OTP when email is provided in body', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .set(authHeader('phone:new-host-phone'))
        .send({
          firstName: 'Priya',
          lastName: 'Nair',
          accountType: 'HOST',
          hostType: 'INDIVIDUAL',
          categoryIds: [TEST_CATEGORY_IDS.outdoor],
          email: 'priya-phone@example.com',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.email).toBe('priya-phone@example.com');
      expect(res.body.data.role).toMatchObject({ name: 'HOST' });
    });

    it('returns 400 when phone-OTP HOST registration omits email', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .set(authHeader('phone:new-host-no-email'))
        .send({
          firstName: 'Priya',
          lastName: 'Nair',
          accountType: 'HOST',
          hostType: 'INDIVIDUAL',
          categoryIds: [TEST_CATEGORY_IDS.outdoor],
        });

      expect(res.status).toBe(400);
    });

    it('returns 409 on duplicate registration', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.newUser, roleName: 'USER' });

      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .set(authHeader(TEST_UIDS.newUser))
        .send({ firstName: 'John', lastName: 'Doe' });

      expect(res.status).toBe(409);
    });

    it('returns 400 when HOST registration omits hostType', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .set(authHeader(TEST_UIDS.newHost))
        .send({ firstName: 'A', lastName: 'B', accountType: 'HOST', categoryIds: [TEST_CATEGORY_IDS.outdoor] });

      expect(res.status).toBe(400);
    });

    it('returns 400 when HOST registration omits categoryIds', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .set(authHeader(TEST_UIDS.newHost))
        .send({ firstName: 'A', lastName: 'B', accountType: 'HOST', hostType: 'INDIVIDUAL' });

      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid PAN format', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .set(authHeader(TEST_UIDS.newUser))
        .send({ firstName: 'A', lastName: 'B', pan: 'not-a-pan' });

      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid phone format (missing +)', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .set(authHeader(TEST_UIDS.newUser))
        .send({ firstName: 'A', lastName: 'B', phone: '9876543210' });

      expect(res.status).toBe(400);
    });

    it('returns 401 when no auth header is present', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ firstName: 'A', lastName: 'B' });

      expect(res.status).toBe(401);
    });
  });

  // ── GET /auth/me ────────────────────────────────────────────────────────

  describe('GET /auth/me', () => {
    it('returns own profile for registered user', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.user, roleName: 'USER', firstName: 'Rahul', lastName: 'Sharma' });

      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set(authHeader(TEST_UIDS.user));

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ firstName: 'Rahul', role: { name: 'USER' } });
    });

    it('returns 404 for unregistered UID', async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set(authHeader('unregistered-uid'));

      expect(res.status).toBe(404);
    });

    it('returns 401 without auth header', async () => {
      const res = await request(app.getHttpServer()).get('/auth/me');
      expect(res.status).toBe(401);
    });
  });

  // ── POST /auth/activate ─────────────────────────────────────────────────

  describe('POST /auth/activate', () => {
    it('activates an invited admin account', async () => {
      await createTestUser(prisma, {
        uid: TEST_UIDS.cityAdmin,
        roleName: 'CITY_ADMIN',
        isActive: false,
        mustCompleteProfile: true,
      });

      const res = await request(app.getHttpServer())
        .post('/auth/activate')
        .set(authHeader(TEST_UIDS.cityAdmin));

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ isActive: true, mustCompleteProfile: false });
    });

    it('returns 400 when account is already active', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.cityAdmin, roleName: 'CITY_ADMIN', isActive: true });

      const res = await request(app.getHttpServer())
        .post('/auth/activate')
        .set(authHeader(TEST_UIDS.cityAdmin));

      expect(res.status).toBe(400);
    });
  });

  // ── POST /auth/complete-profile ─────────────────────────────────────────

  describe('POST /auth/complete-profile', () => {
    it('fills in name and activates account', async () => {
      await createTestUser(prisma, {
        uid: TEST_UIDS.cityAdmin,
        roleName: 'CITY_ADMIN',
        isActive: false,
        mustCompleteProfile: true,
      });

      const res = await request(app.getHttpServer())
        .post('/auth/complete-profile')
        .set(authHeader(TEST_UIDS.cityAdmin))
        .send({ firstName: 'Aishik', lastName: 'Sikdar', phone: '+919876543210' });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ firstName: 'Aishik', isActive: true });
    });

    it('returns 400 when profile is already complete', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.cityAdmin, roleName: 'CITY_ADMIN', isActive: true });

      const res = await request(app.getHttpServer())
        .post('/auth/complete-profile')
        .set(authHeader(TEST_UIDS.cityAdmin))
        .send({ firstName: 'A', lastName: 'B' });

      expect(res.status).toBe(400);
    });

    it('returns 400 when firstName is missing', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.cityAdmin, roleName: 'CITY_ADMIN', isActive: false, mustCompleteProfile: true });

      const res = await request(app.getHttpServer())
        .post('/auth/complete-profile')
        .set(authHeader(TEST_UIDS.cityAdmin))
        .send({ lastName: 'Doe' });

      expect(res.status).toBe(400);
    });
  });
});
