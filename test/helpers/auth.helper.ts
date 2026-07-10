// Fixed test UIDs — match users seeded via createTestUser() in db.helper.ts.
export const TEST_UIDS = {
  user: 'test-uid-user',
  host: 'test-uid-host',
  superAdmin: 'test-uid-super-admin',
  cityAdmin: 'test-uid-city-admin',
  moderator: 'test-uid-moderator',
  support: 'test-uid-support',
  // Extra UIDs for registration tests (no DB record yet)
  newUser: 'test-uid-new-user',
  newHost: 'test-uid-new-host',
};

// Category IDs seeded by db.helper.ts — must be valid v4 UUIDs (IsUUID('4') check)
export const TEST_CATEGORY_IDS = {
  outdoor: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  photography: 'a0eebc99-9c0b-4ef8-ab6d-6bb9bd380a22',
};

/**
 * Returns supertest-compatible headers that authenticate as the given UID.
 * The E2E test files mock firebase-admin's verifyIdToken to decode the uid
 * directly from the token string, so we pass uid as the Bearer token.
 */
export function authHeader(uid: string): Record<string, string> {
  return { Authorization: `Bearer ${uid}` };
}
