/**
 * Admin E2E tests
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
    createUser: jest.fn().mockResolvedValue({ uid: 'new-fb-uid' }),
    generatePasswordResetLink: jest.fn().mockResolvedValue('http://reset-link'),
    updateUser: jest.fn().mockResolvedValue({}),
  }),
}));

import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';
import * as firebaseAdmin from 'firebase-admin';
import { PrismaService } from '../src/prisma/prisma.service';
import { buildTestApp, mockMailQueue } from './helpers/app.helper';
import { truncateTables, seedRefData, createTestUser } from './helpers/db.helper';
import { TEST_UIDS, authHeader } from './helpers/auth.helper';

const mockAuth = (firebaseAdmin.auth as jest.Mock)();

describe('Admin (E2E)', () => {
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
    // Restore default mocks after clearAllMocks
    mockAuth.verifyIdToken.mockImplementation((token: string) =>
      Promise.resolve({ uid: token, email: `${token}@test.com`, firebase: { sign_in_provider: 'password' } }),
    );
    mockAuth.getUserByEmail.mockRejectedValue({ errorInfo: { code: 'auth/user-not-found' } });
    mockAuth.createUser.mockResolvedValue({ uid: 'new-fb-uid' });
    mockAuth.generatePasswordResetLink.mockResolvedValue('http://reset-link');
    mockAuth.updateUser.mockResolvedValue({});
  });

  // ── POST /admin/invite ─────────────────────────────────────────────────

  describe('POST /admin/invite', () => {
    it('SUPER_ADMIN can invite a MODERATOR', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.superAdmin, roleName: 'SUPER_ADMIN' });

      const moderatorRole = await prisma.role.findUniqueOrThrow({ where: { name: 'MODERATOR' } });

      const res = await request(app.getHttpServer())
        .post('/admin/invite')
        .set(authHeader(TEST_UIDS.superAdmin))
        .send({
          email: 'new-mod@meetday.in',
          firstName: 'Mod',
          lastName: 'User',
          roleId: moderatorRole.id,
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ message: 'Invitation sent' });
      expect(mockMailQueue.add).toHaveBeenCalledWith('admin-invite', expect.any(Object));
    });

    it('SUPER_ADMIN can invite a CITY_ADMIN with managedCities', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.superAdmin, roleName: 'SUPER_ADMIN' });
      const role = await prisma.role.findUniqueOrThrow({ where: { name: 'CITY_ADMIN' } });

      const res = await request(app.getHttpServer())
        .post('/admin/invite')
        .set(authHeader(TEST_UIDS.superAdmin))
        .send({
          email: 'city-admin@meetday.in',
          firstName: 'City',
          lastName: 'Admin',
          roleId: role.id,
          managedCities: ['Mumbai'],
        });

      expect(res.status).toBe(201);
    });

    it('returns 403 when a non-SUPER_ADMIN tries to invite', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.cityAdmin, roleName: 'CITY_ADMIN' });

      const moderatorRole = await prisma.role.findUniqueOrThrow({ where: { name: 'MODERATOR' } });

      const res = await request(app.getHttpServer())
        .post('/admin/invite')
        .set(authHeader(TEST_UIDS.cityAdmin))
        .send({ email: 'x@y.com', firstName: 'A', lastName: 'B', roleId: moderatorRole.id });

      expect(res.status).toBe(403);
    });

    it('returns 400 when CITY_ADMIN role is invited without managedCities', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.superAdmin, roleName: 'SUPER_ADMIN' });
      const role = await prisma.role.findUniqueOrThrow({ where: { name: 'CITY_ADMIN' } });

      const res = await request(app.getHttpServer())
        .post('/admin/invite')
        .set(authHeader(TEST_UIDS.superAdmin))
        .send({ email: 'city@meetday.in', firstName: 'City', lastName: 'Admin', roleId: role.id });

      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid email format', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.superAdmin, roleName: 'SUPER_ADMIN' });
      const role = await prisma.role.findUniqueOrThrow({ where: { name: 'MODERATOR' } });

      const res = await request(app.getHttpServer())
        .post('/admin/invite')
        .set(authHeader(TEST_UIDS.superAdmin))
        .send({ email: 'not-an-email', firstName: 'A', lastName: 'B', roleId: role.id });

      expect(res.status).toBe(400);
    });
  });

  // ── GET /admin/hosts/pending ────────────────────────────────────────────

  describe('GET /admin/hosts/pending', () => {
    it('returns FIFO list of KYC-verified, approval-pending hosts', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.superAdmin, roleName: 'SUPER_ADMIN' });

      // Create two hosts with kycStatus=VERIFIED and approvalStatus=PENDING
      const h1 = await createTestUser(prisma, { uid: 'host-1', roleName: 'HOST', email: 'h1@test.com' });
      const h2 = await createTestUser(prisma, { uid: 'host-2', roleName: 'HOST', email: 'h2@test.com' });
      await prisma.hostProfile.create({
        data: { userId: h1.id, hostType: 'INDIVIDUAL', kycStatus: 'VERIFIED', approvalStatus: 'PENDING', currentPlan: 'DISCOVER' },
      });
      await prisma.hostProfile.create({
        data: { userId: h2.id, hostType: 'INDIVIDUAL', kycStatus: 'VERIFIED', approvalStatus: 'PENDING', currentPlan: 'DISCOVER' },
      });

      const res = await request(app.getHttpServer())
        .get('/admin/hosts/pending')
        .set(authHeader(TEST_UIDS.superAdmin));

      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(2);
    });

    it('returns 403 for SUPPORT role', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.support, roleName: 'SUPPORT' });

      const res = await request(app.getHttpServer())
        .get('/admin/hosts/pending')
        .set(authHeader(TEST_UIDS.support));

      expect(res.status).toBe(403);
    });
  });

  // ── POST /admin/hosts/:id/approve ────────────────────────────────────────

  describe('POST /admin/hosts/:id/approve', () => {
    it('approves a KYC-verified, pending host', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.superAdmin, roleName: 'SUPER_ADMIN' });
      const hostUser = await createTestUser(prisma, { uid: TEST_UIDS.host, roleName: 'HOST', email: 'host@test.com' });
      const hp = await prisma.hostProfile.create({
        data: { userId: hostUser.id, hostType: 'INDIVIDUAL', kycStatus: 'VERIFIED', approvalStatus: 'PENDING', currentPlan: 'DISCOVER' },
      });

      const res = await request(app.getHttpServer())
        .post(`/admin/hosts/${hp.id}/approve`)
        .set(authHeader(TEST_UIDS.superAdmin));

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ message: 'Host approved successfully' });
      expect(mockMailQueue.add).toHaveBeenCalledWith('host-approved', expect.any(Object));

      const updated = await prisma.hostProfile.findUnique({ where: { id: hp.id } });
      expect(updated!.approvalStatus).toBe('APPROVED');
    });

    it('returns 400 when KYC is not verified', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.superAdmin, roleName: 'SUPER_ADMIN' });
      const hostUser = await createTestUser(prisma, { uid: TEST_UIDS.host, roleName: 'HOST', email: 'host@test.com' });
      const hp = await prisma.hostProfile.create({
        data: { userId: hostUser.id, hostType: 'INDIVIDUAL', kycStatus: 'PENDING', approvalStatus: 'PENDING', currentPlan: 'DISCOVER' },
      });

      const res = await request(app.getHttpServer())
        .post(`/admin/hosts/${hp.id}/approve`)
        .set(authHeader(TEST_UIDS.superAdmin));

      expect(res.status).toBe(400);
    });

    it('returns 403 when called by MODERATOR', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.moderator, roleName: 'MODERATOR' });
      const hostUser = await createTestUser(prisma, { uid: TEST_UIDS.host, roleName: 'HOST', email: 'host@test.com' });
      const hp = await prisma.hostProfile.create({
        data: { userId: hostUser.id, hostType: 'INDIVIDUAL', kycStatus: 'VERIFIED', approvalStatus: 'PENDING', currentPlan: 'DISCOVER' },
      });

      const res = await request(app.getHttpServer())
        .post(`/admin/hosts/${hp.id}/approve`)
        .set(authHeader(TEST_UIDS.moderator));

      expect(res.status).toBe(403);
    });
  });

  // ── POST /admin/hosts/:id/reject ─────────────────────────────────────────

  describe('POST /admin/hosts/:id/reject', () => {
    it('rejects a pending host with a reason', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.superAdmin, roleName: 'SUPER_ADMIN' });
      const hostUser = await createTestUser(prisma, { uid: TEST_UIDS.host, roleName: 'HOST', email: 'host@test.com' });
      const hp = await prisma.hostProfile.create({
        data: { userId: hostUser.id, hostType: 'INDIVIDUAL', kycStatus: 'VERIFIED', approvalStatus: 'PENDING', currentPlan: 'DISCOVER' },
      });

      const res = await request(app.getHttpServer())
        .post(`/admin/hosts/${hp.id}/reject`)
        .set(authHeader(TEST_UIDS.superAdmin))
        .send({ rejectionReason: 'Portfolio links are broken and portfolio is unverifiable.' });

      expect(res.status).toBe(200);
      expect(mockMailQueue.add).toHaveBeenCalledWith('host-rejected', expect.any(Object));

      const updated = await prisma.hostProfile.findUnique({ where: { id: hp.id } });
      expect(updated!.approvalStatus).toBe('REJECTED');
    });

    it('returns 400 when rejectionReason is too short', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.superAdmin, roleName: 'SUPER_ADMIN' });
      const hostUser = await createTestUser(prisma, { uid: TEST_UIDS.host, roleName: 'HOST', email: 'host@test.com' });
      const hp = await prisma.hostProfile.create({
        data: { userId: hostUser.id, hostType: 'INDIVIDUAL', kycStatus: 'VERIFIED', approvalStatus: 'PENDING', currentPlan: 'DISCOVER' },
      });

      const res = await request(app.getHttpServer())
        .post(`/admin/hosts/${hp.id}/reject`)
        .set(authHeader(TEST_UIDS.superAdmin))
        .send({ rejectionReason: 'Short' }); // < 10 chars

      expect(res.status).toBe(400);
    });
  });

  // ── PATCH /admin/admins/:id/deactivate ─────────────────────────────────

  describe('PATCH /admin/admins/:id/deactivate', () => {
    it('SUPER_ADMIN can deactivate a MODERATOR', async () => {
      const superAdmin = await createTestUser(prisma, { uid: TEST_UIDS.superAdmin, roleName: 'SUPER_ADMIN' });
      const mod = await createTestUser(prisma, { uid: TEST_UIDS.moderator, roleName: 'MODERATOR' });

      const res = await request(app.getHttpServer())
        .patch(`/admin/admins/${mod.id}/deactivate`)
        .set(authHeader(TEST_UIDS.superAdmin));

      expect(res.status).toBe(200);
      const updated = await prisma.user.findUnique({ where: { id: mod.id } });
      expect(updated!.isActive).toBe(false);
    });

    it('returns 400 when deactivating self', async () => {
      const superAdmin = await createTestUser(prisma, { uid: TEST_UIDS.superAdmin, roleName: 'SUPER_ADMIN' });

      const res = await request(app.getHttpServer())
        .patch(`/admin/admins/${superAdmin.id}/deactivate`)
        .set(authHeader(TEST_UIDS.superAdmin));

      expect(res.status).toBe(400);
    });
  });

  // ── GET /admin/admins ──────────────────────────────────────────────────

  describe('GET /admin/admins', () => {
    it('returns paginated list of admin users', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.superAdmin, roleName: 'SUPER_ADMIN' });
      await createTestUser(prisma, { uid: TEST_UIDS.moderator, roleName: 'MODERATOR' });

      const res = await request(app.getHttpServer())
        .get('/admin/admins')
        .set(authHeader(TEST_UIDS.superAdmin));

      expect(res.status).toBe(200);
      expect(res.body.data.total).toBeGreaterThanOrEqual(1);
    });

    it('returns 400 when limit exceeds 100', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.superAdmin, roleName: 'SUPER_ADMIN' });

      const res = await request(app.getHttpServer())
        .get('/admin/admins?limit=101')
        .set(authHeader(TEST_UIDS.superAdmin));

      expect(res.status).toBe(400);
    });
  });

  // ── POST /admin/categories ─────────────────────────────────────────────

  describe('POST /admin/categories', () => {
    it('SUPER_ADMIN creates a category', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.superAdmin, roleName: 'SUPER_ADMIN' });

      const res = await request(app.getHttpServer())
        .post('/admin/categories')
        .set(authHeader(TEST_UIDS.superAdmin))
        .send({ name: 'Tech Talks', description: 'Developer meetups and workshops' });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ name: 'Tech Talks', isActive: true });
    });

    it('returns 409 for duplicate category name', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.superAdmin, roleName: 'SUPER_ADMIN' });
      // "Outdoor Adventures" is seeded by seedRefData
      const res = await request(app.getHttpServer())
        .post('/admin/categories')
        .set(authHeader(TEST_UIDS.superAdmin))
        .send({ name: 'Outdoor Adventures' });

      expect(res.status).toBe(409);
    });

    it('returns 400 when name is too short', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.superAdmin, roleName: 'SUPER_ADMIN' });

      const res = await request(app.getHttpServer())
        .post('/admin/categories')
        .set(authHeader(TEST_UIDS.superAdmin))
        .send({ name: 'X' }); // < 2 chars

      expect(res.status).toBe(400);
    });

    it('returns 403 when called by MODERATOR', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.moderator, roleName: 'MODERATOR' });

      const res = await request(app.getHttpServer())
        .post('/admin/categories')
        .set(authHeader(TEST_UIDS.moderator))
        .send({ name: 'Valid Name' });

      expect(res.status).toBe(403);
    });
  });

  // ── PATCH /admin/categories/:id ────────────────────────────────────────

  describe('PATCH /admin/categories/:id', () => {
    it('SUPER_ADMIN renames a category', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.superAdmin, roleName: 'SUPER_ADMIN' });
      const cat = await prisma.category.findFirstOrThrow({ where: { name: 'Outdoor Adventures' } });

      const res = await request(app.getHttpServer())
        .patch(`/admin/categories/${cat.id}`)
        .set(authHeader(TEST_UIDS.superAdmin))
        .send({ name: 'Nature Escapes' });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ name: 'Nature Escapes' });
    });

    it('SUPER_ADMIN deactivates a category', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.superAdmin, roleName: 'SUPER_ADMIN' });
      const cat = await prisma.category.findFirstOrThrow({ where: { name: 'Outdoor Adventures' } });

      const res = await request(app.getHttpServer())
        .patch(`/admin/categories/${cat.id}`)
        .set(authHeader(TEST_UIDS.superAdmin))
        .send({ isActive: false });

      expect(res.status).toBe(200);
      const updated = await prisma.category.findUnique({ where: { id: cat.id } });
      expect((updated as any).isActive).toBe(false);
    });

    it('returns 404 for unknown category', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.superAdmin, roleName: 'SUPER_ADMIN' });

      const res = await request(app.getHttpServer())
        .patch('/admin/categories/00000000-0000-4000-8000-000000000000')
        .set(authHeader(TEST_UIDS.superAdmin))
        .send({ name: 'New Name' });

      expect(res.status).toBe(404);
    });
  });

  // ── GET /admin/categories ──────────────────────────────────────────────

  describe('GET /admin/categories', () => {
    it('returns all categories including inactive ones', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.superAdmin, roleName: 'SUPER_ADMIN' });

      const res = await request(app.getHttpServer())
        .get('/admin/categories')
        .set(authHeader(TEST_UIDS.superAdmin));

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      // isActive field present in admin view
      expect(res.body.data[0]).toHaveProperty('isActive');
    });
  });

  // ── GET /categories (public) ───────────────────────────────────────────

  describe('GET /categories', () => {
    it('returns active categories without authentication', async () => {
      const res = await request(app.getHttpServer()).get('/categories');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      // Public response should NOT include isActive
      if (res.body.data.length > 0) {
        expect(res.body.data[0]).not.toHaveProperty('isActive');
      }
    });

    it('does not return deactivated categories', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.superAdmin, roleName: 'SUPER_ADMIN' });
      const cat = await prisma.category.findFirstOrThrow({ where: { name: 'Outdoor Adventures' } });

      // Deactivate through admin endpoint
      await request(app.getHttpServer())
        .patch(`/admin/categories/${cat.id}`)
        .set(authHeader(TEST_UIDS.superAdmin))
        .send({ isActive: false });

      const res = await request(app.getHttpServer()).get('/categories');
      const names = res.body.data.map((c: any) => c.name);
      expect(names).not.toContain('Outdoor Adventures');
    });
  });
});
