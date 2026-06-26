const wrapData = (data: unknown) => ({
  success: true,
  timestamp: '2026-06-26T10:00:00.000Z',
  data,
});

const MEMBER_ITEM = {
  userId: 'u1a2b3c4-d5e6-7890-abcd-ef1234567890',
  name: 'Rishav Sen',
  email: 'rishav@example.com',
  avatarUrl: 'https://storage.googleapis.com/meetday-media/avatars/rishav.jpg?X-Goog-Signature=...',
  role: 'MEMBER',
  status: 'ACTIVE',
  joinedAt: '2024-05-18T09:42:00.000Z',
  lastActiveAt: '2026-06-26T14:15:00.000Z',
  engagementPct: 85,
  engagementLevel: 'high',
  activityScore: 51,
  messageCount: 41,
  eventsAttendedCount: 2,
  bannedAt: null,
};

export const MEMBER_STATS_EXAMPLE = wrapData({
  totalMembers: 1248,
  activeMembers: { value: 786, deltaPct: 12 },
  newMembers: { value: 142, deltaPct: 18 },
  engagementRate: { value: 62, deltaPct: 8 },
  retentionRate: { value: 72, deltaPct: 6 },
  tabCounts: { all: 1248, active: 786, new: 142, inactive: 216, banned: 12 },
});

export const LIST_MEMBERS_EXAMPLE = wrapData({
  items: [
    MEMBER_ITEM,
    {
      ...MEMBER_ITEM,
      userId: 'u9f8e7d6-c5b4-3210-fedc-ba9876543210',
      name: 'Priya Nair',
      email: 'priya@example.com',
      role: 'MODERATOR',
      engagementPct: 42,
      engagementLevel: 'medium',
      activityScore: 25,
      messageCount: 20,
      eventsAttendedCount: 1,
    },
  ],
  total: 1248,
  page: 1,
  limit: 20,
  totalPages: 63,
});

export const MEMBER_DETAIL_EXAMPLE = wrapData({
  ...MEMBER_ITEM,
  bannedBy: null,
  memberSince: '2023-11-01T00:00:00.000Z',
});

export const INSIGHTS_EXAMPLE = wrapData({
  topCities: [
    { city: 'Kolkata', count: 474, pct: 38 },
    { city: 'Mumbai', count: 274, pct: 22 },
    { city: 'Bangalore', count: 187, pct: 15 },
    { city: 'Delhi', count: 149, pct: 12 },
    { city: 'Chennai', count: 87, pct: 7 },
  ],
  memberSegments: [
    { label: 'Music Lovers', count: 649, pct: 52 },
    { label: 'Creative Pros', count: 312, pct: 25 },
    { label: 'Event Hosts', count: 87, pct: 7 },
    { label: 'Power Members', count: 124, pct: 10 },
  ],
});

export const INVITE_EXAMPLE = wrapData({
  token: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  inviteUrl: 'https://meetday.ai/join/a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  expiresAt: '2026-07-03T10:00:00.000Z',
  maxUses: 50,
});

export const EXPORT_MEMBERS_EXAMPLE =
  'firstName,lastName,email,role,status,joinedAt,lastActivityAt,activityScore,messageCount,eventsAttendedCount\n' +
  '"Rishav","Sen","rishav@example.com","MEMBER","ACTIVE","2024-05-18T09:42:00.000Z","2026-06-26T14:15:00.000Z","51","41","2"';

export const IMPORT_MEMBERS_EXAMPLE = wrapData({
  imported: 8,
  skipped: 2,
  notFound: 1,
  errors: [],
});

export const BAN_MEMBER_EXAMPLE = wrapData({ success: true });
export const UNBAN_MEMBER_EXAMPLE = wrapData({ success: true });
export const KICK_MEMBER_EXAMPLE = wrapData({ success: true });
