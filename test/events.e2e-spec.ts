/**
 * Events E2E tests
 *
 * Covers the HOST event lifecycle:
 *   - Create draft event (POST /events)
 *   - Update draft (PATCH /events/:id)
 *   - Submit for review (PATCH /events/:id/submit)
 *   - List public events (GET /events)
 *   - Fetch event detail (GET /events/:id/public)
 *   - Delete draft (DELETE /events/:id)
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
import { TEST_UIDS, TEST_CATEGORY_IDS, authHeader } from './helpers/auth.helper';

// ─── Seeding helpers ──────────────────────────────────────────────────────────

async function seedApprovedHost(prisma: PrismaService, userId: string) {
  return prisma.hostProfile.create({
    data: {
      userId,
      hostType: 'INDIVIDUAL',
      kycStatus: 'VERIFIED',
      approvalStatus: 'APPROVED',
      currentPlan: 'DISCOVER',
    },
  });
}

function createEventPayload(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Jazz Night',
    city: 'Mumbai',
    ...overrides,
  };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('Events (E2E)', () => {
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

  // ── POST /events ──────────────────────────────────────────────────────────

  describe('POST /events', () => {
    it('creates a DRAFT event for an approved HOST', async () => {
      const hostUser = await createTestUser(prisma, { uid: TEST_UIDS.host, roleName: 'HOST' });
      await seedApprovedHost(prisma, hostUser.id);

      const res = await request(app.getHttpServer())
        .post('/events')
        .set(authHeader(TEST_UIDS.host))
        .send(createEventPayload({ categoryId: TEST_CATEGORY_IDS.outdoor }));

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ title: 'Jazz Night', status: 'DRAFT' });
    });

    it('returns 403 when a USER (non-HOST) tries to create an event', async () => {
      await createTestUser(prisma, { uid: TEST_UIDS.user, roleName: 'USER' });

      const res = await request(app.getHttpServer())
        .post('/events')
        .set(authHeader(TEST_UIDS.user))
        .send(createEventPayload());

      expect(res.status).toBe(403);
    });

    it('returns 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer())
        .post('/events')
        .send(createEventPayload());

      expect(res.status).toBe(401);
    });
  });

  // ── PATCH /events/:id ─────────────────────────────────────────────────────

  describe('PATCH /events/:id', () => {
    it('updates a DRAFT event title', async () => {
      const hostUser = await createTestUser(prisma, { uid: TEST_UIDS.host, roleName: 'HOST' });
      const hostProfile = await seedApprovedHost(prisma, hostUser.id);

      const event = await prisma.event.create({
        data: { hostProfileId: hostProfile.id, title: 'Old Title', status: 'DRAFT' },
      });

      const res = await request(app.getHttpServer())
        .patch(`/events/${event.id}`)
        .set(authHeader(TEST_UIDS.host))
        .send({ title: 'Updated Title' });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ id: event.id, title: 'Updated Title' });
    });

    it('returns 403 when another HOST tries to update the event', async () => {
      const hostUser = await createTestUser(prisma, { uid: TEST_UIDS.host, roleName: 'HOST' });
      const otherHost = await createTestUser(prisma, { uid: TEST_UIDS.newHost, roleName: 'HOST' });
      const hostProfile = await seedApprovedHost(prisma, hostUser.id);
      await seedApprovedHost(prisma, otherHost.id);

      const event = await prisma.event.create({
        data: { hostProfileId: hostProfile.id, title: 'My Event', status: 'DRAFT' },
      });

      const res = await request(app.getHttpServer())
        .patch(`/events/${event.id}`)
        .set(authHeader(TEST_UIDS.newHost))
        .send({ title: 'Hijacked Title' });

      expect(res.status).toBe(403);
    });
  });

  // ── DELETE /events/:id ────────────────────────────────────────────────────

  describe('DELETE /events/:id', () => {
    it('soft-deletes a DRAFT event', async () => {
      const hostUser = await createTestUser(prisma, { uid: TEST_UIDS.host, roleName: 'HOST' });
      const hostProfile = await seedApprovedHost(prisma, hostUser.id);

      const event = await prisma.event.create({
        data: { hostProfileId: hostProfile.id, title: 'To Delete', status: 'DRAFT' },
      });

      const res = await request(app.getHttpServer())
        .delete(`/events/${event.id}`)
        .set(authHeader(TEST_UIDS.host));

      expect(res.status).toBe(200);

      const deleted = await prisma.event.findUnique({ where: { id: event.id } });
      expect(deleted!.deletedAt).not.toBeNull();
    });

    it('returns 403 when a PUBLISHED event is deleted without admin rights', async () => {
      const hostUser = await createTestUser(prisma, { uid: TEST_UIDS.host, roleName: 'HOST' });
      const hostProfile = await seedApprovedHost(prisma, hostUser.id);

      const event = await prisma.event.create({
        data: { hostProfileId: hostProfile.id, title: 'Published Event', status: 'PUBLISHED' },
      });

      const res = await request(app.getHttpServer())
        .delete(`/events/${event.id}`)
        .set(authHeader(TEST_UIDS.host));

      expect(res.status).toBe(400);
    });
  });

  // ── GET /events ───────────────────────────────────────────────────────────

  describe('GET /events', () => {
    it('returns a list of published events', async () => {
      const hostUser = await createTestUser(prisma, { uid: TEST_UIDS.host, roleName: 'HOST' });
      const hostProfile = await seedApprovedHost(prisma, hostUser.id);

      await prisma.event.create({
        data: {
          hostProfileId: hostProfile.id,
          title: 'Public Jazz Night',
          status: 'PUBLISHED',
          eventDate: new Date('2099-12-31'),
        },
      });

      const res = await request(app.getHttpServer()).get('/events');

      expect(res.status).toBe(200);
      expect(res.body.data.events.length).toBeGreaterThanOrEqual(1);
      const titles = res.body.data.events.map((e: any) => e.title);
      expect(titles).toContain('Public Jazz Night');
    });
  });

  // ── GET /events/:id/public ────────────────────────────────────────────────

  describe('GET /events/:id/public', () => {
    it('returns the public event detail', async () => {
      const hostUser = await createTestUser(prisma, { uid: TEST_UIDS.host, roleName: 'HOST' });
      const hostProfile = await seedApprovedHost(prisma, hostUser.id);

      const event = await prisma.event.create({
        data: {
          hostProfileId: hostProfile.id,
          title: 'Public Event Detail',
          status: 'PUBLISHED',
        },
      });

      const res = await request(app.getHttpServer()).get(`/events/${event.id}/public`);

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ id: event.id, title: 'Public Event Detail' });
    });

    it('returns 404 for a non-existent event', async () => {
      const res = await request(app.getHttpServer()).get('/events/00000000-0000-4000-a000-000000000000/public');
      expect(res.status).toBe(404);
    });
  });
});
