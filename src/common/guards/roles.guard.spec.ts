import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { RolesGuard } from './roles.guard';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeContext(requiredRoles: string[] | undefined, request: any) {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(requiredRoles) };
  const context: any = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({ getRequest: () => request }),
  };
  return { reflector, context };
}

function makePrisma(user: any) {
  return { user: { findUnique: jest.fn().mockResolvedValue(user) } } as any;
}// ── Test suite ───────────────────────────────────────────────────────────────
//
// Verifies the "one identity, multiple portals" behaviour: a single User row can hold a
// primary `role` (HOST/BRAND/USER), a secondary `adminRole` (SUPER_ADMIN/CITY_ADMIN/MODERATOR),
// and independently a hostProfile and/or brandProfile — and RolesGuard must grant access to
// each portal's endpoints based on whichever of these the user actually has, not just the
// single primary role.

describe('RolesGuard', () => {
  it('allows access when the primary role matches (existing single-role behaviour)', async () => {
    const request: any = { user: { uid: 'fb-1' } };
    const user = {
      id: 'u1',
      isActive: true,
      role: { name: 'HOST' },
      adminRole: null,
      hostProfile: { id: 'hp1' },
      brandProfile: null,
    };
    const { reflector, context } = makeContext(['HOST'], request);
    const guard = new RolesGuard(reflector as any, makePrisma(user));

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toMatchObject({ role: 'HOST', roles: ['HOST'] });
  });

  it('grants BRAND access to a primary-HOST user who also has a brandProfile', async () => {
    const request: any = { user: { uid: 'fb-1' } };
    const user = {
      id: 'u1',
      isActive: true,
      role: { name: 'HOST' },
      adminRole: null,
      hostProfile: { id: 'hp1' },
      brandProfile: { id: 'bp1' },
    };
    const { reflector, context } = makeContext(['BRAND'], request);
    const guard = new RolesGuard(reflector as any, makePrisma(user));

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user.roles).toEqual(expect.arrayContaining(['HOST', 'BRAND']));
  });

  it('grants HOST access to a primary-BRAND user who also has a hostProfile', async () => {
    const request: any = { user: { uid: 'fb-1' } };
    const user = {
      id: 'u1',
      isActive: true,
      role: { name: 'BRAND' },
      adminRole: null,
      hostProfile: { id: 'hp1' },
      brandProfile: { id: 'bp1' },
    };
    const { reflector, context } = makeContext(['HOST'], request);
    const guard = new RolesGuard(reflector as any, makePrisma(user));

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('grants CITY_ADMIN access to a primary-HOST user who was separately granted adminRole', async () => {
    const request: any = { user: { uid: 'fb-1' } };
    const user = {
      id: 'u1',
      isActive: true,
      role: { name: 'HOST' },
      adminRole: { name: 'CITY_ADMIN' },
      hostProfile: { id: 'hp1' },
      brandProfile: null,
    };
    const { reflector, context } = makeContext(['CITY_ADMIN', 'MODERATOR', 'SUPER_ADMIN'], request);
    const guard = new RolesGuard(reflector as any, makePrisma(user));

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('one identity can access HOST, BRAND, and CITY_ADMIN endpoints simultaneously', async () => {
    const user = {
      id: 'u1',
      isActive: true,
      role: { name: 'HOST' },
      adminRole: { name: 'CITY_ADMIN' },
      hostProfile: { id: 'hp1' },
      brandProfile: { id: 'bp1' },
    };

    for (const required of [['HOST'], ['BRAND'], ['CITY_ADMIN']]) {
      const request: any = { user: { uid: 'fb-1' } };
      const { reflector, context } = makeContext(required, request);
      const guard = new RolesGuard(reflector as any, makePrisma(user));
      await expect(guard.canActivate(context)).resolves.toBe(true);
    }
  });

  it('denies BRAND access when the user has neither BRAND role nor a brandProfile', async () => {
    const request: any = { user: { uid: 'fb-1' } };
    const user = {
      id: 'u1',
      isActive: true,
      role: { name: 'HOST' },
      adminRole: null,
      hostProfile: { id: 'hp1' },
      brandProfile: null,
    };
    const { reflector, context } = makeContext(['BRAND'], request);
    const guard = new RolesGuard(reflector as any, makePrisma(user));

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFoundException when no User row exists for the Firebase UID', async () => {
    const request: any = { user: { uid: 'fb-unknown' } };
    const { reflector, context } = makeContext(['HOST'], request);
    const guard = new RolesGuard(reflector as any, makePrisma(null));

    await expect(guard.canActivate(context)).rejects.toThrow(NotFoundException);
  });

  it('throws ForbiddenException when the user is inactive', async () => {
    const request: any = { user: { uid: 'fb-1' } };
    const user = { id: 'u1', isActive: false, role: { name: 'HOST' }, adminRole: null, hostProfile: null, brandProfile: null };
    const { reflector, context } = makeContext(['HOST'], request);
    const guard = new RolesGuard(reflector as any, makePrisma(user));

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('allows access with no @Roles() restriction regardless of role', async () => {
    const request: any = { user: { uid: 'fb-1' } };
    const user = { id: 'u1', isActive: true, role: { name: 'USER' }, adminRole: null, hostProfile: null, brandProfile: null };
    const { reflector, context } = makeContext(undefined, request);
    const guard = new RolesGuard(reflector as any, makePrisma(user));

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
