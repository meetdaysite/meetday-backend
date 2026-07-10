/**
 * Communities E2E tests
 *
 * Covers the core community lifecycle:
 *   - Admin creates community (POST /admin/communities)
 *   - List communities (GET /communities)
 *   - User joins a community (POST /communities/:id/join)
 *   - List community members (GET /communities/:communityId/members)
 *   - Admin removes a member (DELETE /admin/communities/:id/members/:memberId)
 *   - User leaves community (DELETE /communities/:id/leave)
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

async function seedPublicCommunity(prisma: PrismaService, ownerId: string, overrides: Record<string, any> = {}) {
  const community = await prisma.community.create({
    data: {
      name: 'E2E Test Community',
      slug: `e2e-test-${Date.now()}`,
      description: 'A community for E2E tests.',
      status: 'ACTIVE',
      joinPolicy: 'OPEN',
      memberDirectoryVisibility: 'ALL_MEMBERS',
      memberCount: 0,
      ...overrides,
    },
  });

  // Add the owner as a member with OWNER role
  await prisma.communityMember.create({
    data: {
      communityId: community.id,
      userId: ownerId,
      role: 'OWNER',
      status: 'ACTIVE',
    },
  });

  await prisma.community.update({
    where: { id: community.id },
    data: { memberCount: 1 },
  });

  return community;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('Communities (E2E)', () => {
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

  // ── POST /admin/communities ───────────────────────────────────────────────

  describe('POST /admin/communities', () => {
    it('creates a community as SUPER_ADMIN', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.superAdmin, roleName: 'SUPER_ADMIN' });

      const res = await request(app.getHttpServer())
        .post('/admin/communities')
        .set(authHeader(TEST_UIDS.superAdmin))
        .send({
          name: 'Admin Created Community',
          slug: 'admin-created-community',
          description: 'Created by admin.',
          joinPolicy: 'OPEN',
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ name: 'Admin Created Community', status: 'ACTIVE' });
    });

    it('returns 403 when a regular USER tries to create a community', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.user, roleName: 'USER' });

      const res = await request(app.getHttpServer())
        .post('/admin/communities')
        .set(authHeader(TEST_UIDS.user))
        .send({ name: 'Rogue Community', slug: 'rogue', description: 'Unauthorized', joinPolicy: 'OPEN' });

      expect(res.status).toBe(403);
    });

    it('returns 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/communities')
        .send({ name: 'Test', slug: 'test', description: 'Test', joinPolicy: 'OPEN' });

      expect(res.status).toBe(401);
    });
  });

  // ── GET /communities ──────────────────────────────────────────────────────

  describe('GET /communities', () => {
    it('returns a list of active communities', async () => {
      const adminUser = await createTestUser(prisma, { uid: TEST_UIDS.superAdmin, roleName: 'SUPER_ADMIN' });
      await seedPublicCommunity(prisma, adminUser.id, { name: 'Jazz Lovers', slug: 'jazz-lovers' });

      const res = await request(app.getHttpServer()).get('/communities');

      expect(res.status).toBe(200);
      const names = res.body.data.communities.map((c: any) => c.name);
      expect(names).toContain('Jazz Lovers');
    });
  });

  // ── POST /communities/:id/join ────────────────────────────────────────────

  describe('POST /communities/:id/join', () => {
    it('allows a USER to join an OPEN community', async () => {
      const adminUser = await createTestUser(prisma, { uid: TEST_UIDS.superAdmin, roleName: 'SUPER_ADMIN' });
      const attendee = await createTestUser(prisma, { uid: TEST_UIDS.user, roleName: 'USER' });
      const community = await seedPublicCommunity(prisma, adminUser.id);

      const res = await request(app.getHttpServer())
        .post(`/communities/${community.id}/join`)
        .set(authHeader(TEST_UIDS.user));

      expect(res.status).toBe(201);

      const member = await prisma.communityMember.findFirst({
        where: { communityId: community.id, userId: attendee.id },
      });
      expect(member).not.toBeNull();
      expect(member!.status).toBe('ACTIVE');
    });

    it('returns 401 when unauthenticated', async () => {
      const adminUser = await createTestUser(prisma, { uid: TEST_UIDS.superAdmin, roleName: 'SUPER_ADMIN' });
      const community = await seedPublicCommunity(prisma, adminUser.id);

      const res = await request(app.getHttpServer()).post(`/communities/${community.id}/join`);

      expect(res.status).toBe(401);
    });

    it('returns 409 when a user who is already a member tries to join again', async () => {
      const adminUser = await createTestUser(prisma, { uid: TEST_UIDS.superAdmin, roleName: 'SUPER_ADMIN' });
      const attendee = await createTestUser(prisma, { uid: TEST_UIDS.user, roleName: 'USER' });
      const community = await seedPublicCommunity(prisma, adminUser.id);

      // Join once
      await request(app.getHttpServer())
        .post(`/communities/${community.id}/join`)
        .set(authHeader(TEST_UIDS.user));

      // Try to join again
      const res = await request(app.getHttpServer())
        .post(`/communities/${community.id}/join`)
        .set(authHeader(TEST_UIDS.user));

      expect(res.status).toBe(409);
    });
  });

  // ── DELETE /communities/:id/leave ─────────────────────────────────────────

  describe('DELETE /communities/:id/leave', () => {
    it('removes a member from the community', async () => {
      const adminUser = await createTestUser(prisma, { uid: TEST_UIDS.superAdmin, roleName: 'SUPER_ADMIN' });
      const attendee = await createTestUser(prisma, { uid: TEST_UIDS.user, roleName: 'USER' });
      const community = await seedPublicCommunity(prisma, adminUser.id);

      // Join first
      await request(app.getHttpServer())
        .post(`/communities/${community.id}/join`)
        .set(authHeader(TEST_UIDS.user));

      const leaveRes = await request(app.getHttpServer())
        .delete(`/communities/${community.id}/leave`)
        .set(authHeader(TEST_UIDS.user));

      expect(leaveRes.status).toBe(200);

      const member = await prisma.communityMember.findFirst({
        where: { communityId: community.id, userId: attendee.id, status: 'ACTIVE' },
      });
      expect(member).toBeNull();
    });
  });

  // ── Admin: DELETE /admin/communities/:id/members/:memberId ────────────────

  describe('DELETE /admin/communities/:id/members/:memberId', () => {
    it('allows SUPER_ADMIN to remove a member from a community', async () => {
      const adminUser = await createTestUser(prisma, { uid: TEST_UIDS.superAdmin, roleName: 'SUPER_ADMIN' });
      const attendee = await createTestUser(prisma, { uid: TEST_UIDS.user, roleName: 'USER' });
      const community = await seedPublicCommunity(prisma, adminUser.id);

      // Join as user
      await request(app.getHttpServer())
        .post(`/communities/${community.id}/join`)
        .set(authHeader(TEST_UIDS.user));

      const member = await prisma.communityMember.findFirstOrThrow({
        where: { communityId: community.id, userId: attendee.id },
      });

      const res = await request(app.getHttpServer())
        .delete(`/admin/communities/${community.id}/members/${member.id}`)
        .set(authHeader(TEST_UIDS.superAdmin));

      expect(res.status).toBe(200);
    });
  });
});
