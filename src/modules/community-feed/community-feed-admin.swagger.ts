const wrapData = (data: unknown) => ({
  success: true,
  timestamp: '2026-06-26T10:00:00.000Z',
  data,
});

// ─── Shared example shapes ─────────────────────────────────────────────────────

const AUTHOR_EXAMPLE = {
  id: 'u1v2w3x4-y5z6-7890-abcd-ef1234567890',
  name: 'Riya Mehta',
  avatarUrl: 'https://storage.googleapis.com/meetday-media/avatars/riya.jpg?X-Goog-Signature=...',
};

const POST_ITEM_EXAMPLE = {
  id: 'p1a2b3c4-d5e6-7890-abcd-ef1234567890',
  postType: 'TEXT',
  status: 'PENDING',
  content: 'Which venue do you prefer for the next meetup — Indiranagar or Koramangala?',
  mediaUrls: [],
  author: AUTHOR_EXAMPLE,
  pendingReportCount: 0,
  counts: { reactions: 5, comments: 2, shares: 0, views: 41 },
  isPinned: false,
  deletedAt: null,
  createdAt: '2026-06-26T08:00:00.000Z',
};

const SPARKLINE_7 = [5, 3, 7, 4, 8, 12, 8];

// ─── Exported constants ────────────────────────────────────────────────────────

export const FEED_STATS_EXAMPLE = wrapData({
  postQueue: 14,
  published: 312,
  reported: 3,
  pinned: 2,
});

export const FEED_OVERVIEW_EXAMPLE = wrapData({
  totalPosts: { value: 47, deltaPct: 12, sparkline: SPARKLINE_7 },
  engagement: { value: 284, deltaPct: -4, sparkline: [30, 42, 38, 29, 51, 46, 48] },
  reportsReceived: { value: 7, deltaPct: 40, sparkline: [0, 1, 0, 2, 1, 2, 1] },
  postsApproved: { value: 31, deltaPct: 15, sparkline: [3, 2, 5, 4, 6, 5, 6] },
});

export const LIST_POSTS_EXAMPLE = wrapData({
  items: [
    POST_ITEM_EXAMPLE,
    {
      ...POST_ITEM_EXAMPLE,
      id: 'p9f8e7d6-c5b4-3210-fedc-ba9876543210',
      status: 'PUBLISHED',
      content: "Great session last week! Can't wait for the next one.",
      counts: { reactions: 18, comments: 7, shares: 2, views: 134 },
      isPinned: true,
      createdAt: '2026-06-25T12:00:00.000Z',
    },
  ],
  total: 42,
  page: 1,
  limit: 20,
  totalPages: 3,
});

export const LIST_POSTS_REPORTED_EXAMPLE = wrapData({
  items: [
    {
      ...POST_ITEM_EXAMPLE,
      status: 'PUBLISHED',
      pendingReportCount: 2,
      content: 'Click here for exclusive deals! [spam link]',
    },
  ],
  total: 3,
  page: 1,
  limit: 20,
  totalPages: 1,
});

export const APPROVE_POST_EXAMPLE = wrapData({ success: true });
export const REJECT_POST_EXAMPLE = wrapData({ success: true });
export const DELETE_POST_EXAMPLE = wrapData({ success: true });
export const PIN_POST_EXAMPLE = wrapData({ success: true });
export const UNPIN_POST_EXAMPLE = wrapData({ success: true });
export const RESOLVE_REPORT_EXAMPLE = wrapData({ success: true });
export const DISMISS_REPORT_EXAMPLE = wrapData({ success: true });

export const CREATE_ADMIN_POST_EXAMPLE = wrapData({
  id: 'p2b3c4d5-e6f7-8901-bcde-f01234567890',
  status: 'PUBLISHED',
  createdAt: '2026-06-26T10:30:00.000Z',
});

export const RECENT_REPORTS_EXAMPLE = wrapData([
  {
    reportId: 'r1a2b3c4-d5e6-7890-abcd-ef1234567890',
    postId: 'p1a2b3c4-d5e6-7890-abcd-ef1234567890',
    postSnippet: 'Click here for exclusive deals! [spam link]',
    reporter: { name: 'Arjun Mehta', avatarUrl: null },
    reason: 'SPAM_OR_PROMOTION',
    body: 'This looks like a spam post promoting an external product.',
    label: 'Spam or Promotion',
    severityColor: 'yellow',
    reportedAt: '2026-06-26T09:15:00.000Z',
  },
  {
    reportId: 'r2b3c4d5-e6f7-8901-bcde-f01234567890',
    postId: 'p5e6f7a8-b9c0-1234-defa-bc1234567890',
    postSnippet: 'That member is a total...',
    reporter: { name: 'Priya Nair', avatarUrl: null },
    reason: 'HARASSMENT_OR_ABUSE',
    body: null,
    label: 'Harassment / Abuse',
    severityColor: 'red',
    reportedAt: '2026-06-26T08:42:00.000Z',
  },
]);
