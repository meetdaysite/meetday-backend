/**
 * Cross-portal login E2E tests
 *
 * Verifies the real, end-to-end fix for "auto logout on host/brand login": one Firebase
 * identity can hold a HOST profile and a BRAND profile at once, and RolesGuard grants access
 * to each portal's endpoints based on profile existence, not a single primary role.
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
import { truncateTables, seedRefData } from './helpers/db.helper';
import { TEST_CATEGORY_IDS, authHeader } from './helpers/auth.helper';

describe('Cross-portal login (E2E)', () => {
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

  it('lets one identity register as HOST, then attach a BRAND profile, and access both /hosts/me and /brands/me', async () => {
    const uid = 'test-cross-host-then-brand';

    // 1. Register as HOST.
    const hostRegister = await request(app.getHttpServer())
      .post('/auth/register')
      .set(authHeader(uid))
      .send({
        firstName: 'Gagan',
        lastName: 'K',
        accountType: 'HOST',
        hostType: 'INDIVIDUAL',
        categoryIds: [TEST_CATEGORY_IDS.outdoor],
      });
    expect(hostRegister.status).toBe(201);
    expect(hostRegister.body.data.role).toMatchObject({ name: 'HOST' });

    // 2. Can access /hosts/me immediately.
    const hostsMe = await request(app.getHttpServer()).get('/hosts/me').set(authHeader(uid));
    expect(hostsMe.status).toBe(200);

    // 3. Cannot access /brands/me yet — no brand profile attached (this is the correct,
    // recoverable 403 the frontend now routes to onboarding instead of signing out).
    const brandsMeBefore = await request(app.getHttpServer()).get('/brands/me').set(authHeader(uid));
    expect(brandsMeBefore.status).toBe(403);

    // 4. Registering as BRAND with the SAME identity attaches a BrandProfile instead of
    // rejecting with "already registered".
    const brandRegister = await request(app.getHttpServer())
      .post('/auth/register')
      .set(authHeader(uid))
      .send({ firstName: 'Gagan', lastName: 'K', accountType: 'BRAND', brandName: 'Gagan Co' });
    expect(brandRegister.status).toBe(201);
    expect(brandRegister.body.data.brandProfile).toMatchObject({ brandName: 'Gagan Co' });
    // Primary role is untouched — still HOST.
    expect(brandRegister.body.data.role).toMatchObject({ name: 'HOST' });

    // 5. Now /brands/me works too, AND /hosts/me still works — same login, both portals.
    const brandsMeAfter = await request(app.getHttpServer()).get('/brands/me').set(authHeader(uid));
    expect(brandsMeAfter.status).toBe(200);

    const hostsMeAfter = await request(app.getHttpServer()).get('/hosts/me').set(authHeader(uid));
    expect(hostsMeAfter.status).toBe(200);

    // 6. GET /auth/me reports both accesses for this one identity.
    const me = await request(app.getHttpServer()).get('/auth/me').set(authHeader(uid));
    expect(me.status).toBe(200);
    expect(me.body.data).toMatchObject({ hasHostAccess: true, hasBrandAccess: true });

    // 7. Re-registering a profile type already held is still a conflict.
    const duplicateHostRegister = await request(app.getHttpServer())
      .post('/auth/register')
      .set(authHeader(uid))
      .send({
        firstName: 'Gagan',
        lastName: 'K',
        accountType: 'HOST',
        hostType: 'INDIVIDUAL',
        categoryIds: [TEST_CATEGORY_IDS.outdoor],
      });
    expect(duplicateHostRegister.status).toBe(409);
  });

  it('lets one identity register as BRAND, then attach a HOST profile, and access both portals', async () => {
    const uid = 'test-cross-brand-then-host';

    const brandRegister = await request(app.getHttpServer())
      .post('/auth/register')
      .set(authHeader(uid))
      .send({ firstName: 'Anu', lastName: 'S', accountType: 'BRAND', brandName: 'Anu Co' });
    expect(brandRegister.status).toBe(201);

    const hostsMeBefore = await request(app.getHttpServer()).get('/hosts/me').set(authHeader(uid));
    expect(hostsMeBefore.status).toBe(403);

    const hostRegister = await request(app.getHttpServer())
      .post('/auth/register')
      .set(authHeader(uid))
      .send({
        firstName: 'Anu',
        lastName: 'S',
        accountType: 'HOST',
        hostType: 'INDIVIDUAL',
        categoryIds: [TEST_CATEGORY_IDS.outdoor],
      });
    expect(hostRegister.status).toBe(201);
    // Primary role is untouched — still BRAND.
    expect(hostRegister.body.data.role).toMatchObject({ name: 'BRAND' });

    const hostsMeAfter = await request(app.getHttpServer()).get('/hosts/me').set(authHeader(uid));
    expect(hostsMeAfter.status).toBe(200);

    const brandsMeAfter = await request(app.getHttpServer()).get('/brands/me').set(authHeader(uid));
    expect(brandsMeAfter.status).toBe(200);
  });
});
