/**
 * Response examples for the Community Feed Swagger docs.
 *
 * These are plain objects (not response DTO classes) used via
 * `@ApiOkResponse({ schema: { example } })`. They intentionally mirror the
 * shapes built in `CommunityFeedService.enrich` / `presentComment` — keep them
 * in sync with that service when the payload changes.
 */

/** A single enriched feed post — the shape returned by `enrich`. */
export const FEED_POST_EXAMPLE = {
  id: 'a3f1c2d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d',
  communityId: 'b1c2d3e4-f5a6-7b8c-9d0e-1f2a3b4c5d6e',
  postType: 'POLL',
  category: 'GENERAL',
  topic: 'Saturday Meetup',
  content: 'Which venue should we pick for the next meetup?',
  mediaUrls: [
    'https://cdn.example.com/communities/.../feed/abc.jpg?X-Amz-Signature=...',
  ],
  author: {
    id: 'c2d3e4f5-a6b7-8c9d-0e1f-2a3b4c5d6e7f',
    name: 'Asha Rao',
    avatarUrl: 'https://cdn.example.com/users/.../avatar/xyz.jpg?X-Amz-Signature=...',
    badge: 'TOP_CONTRIBUTOR',
  },
  event: {
    id: 'd3e4f5a6-b7c8-9d0e-1f2a-3b4c5d6e7f80',
    title: 'Founders Mixer',
    eventDate: '2026-07-12T18:30:00.000Z',
    city: 'Bengaluru',
  },
  poll: {
    totalVotes: 23,
    myVote: 'e4f5a6b7-c8d9-0e1f-2a3b-4c5d6e7f8091',
    options: [
      { id: 'e4f5a6b7-c8d9-0e1f-2a3b-4c5d6e7f8091', text: 'Rooftop Cafe', voteCount: 14 },
      { id: 'f5a6b7c8-d9e0-1f2a-3b4c-5d6e7f809102', text: 'Garden Lawn', voteCount: 9 },
    ],
  },
  isPinned: false,
  counts: { reactions: 42, comments: 7, shares: 3, views: 310, bookmarks: 5 },
  reactedByMe: true,
  myReactions: ['❤️'],
  bookmarkedByMe: false,
  sharedByMe: false,
  createdAt: '2026-06-24T09:15:00.000Z',
};

/** A cursor-paginated page of feed posts — the shape returned by `listPosts`. */
export const FEED_PAGE_EXAMPLE = {
  items: [FEED_POST_EXAMPLE],
  nextCursor: '2026-06-24T09:15:00.000Z',
};

/** A single comment — the shape returned by `presentComment`. */
export const COMMENT_EXAMPLE = {
  id: 'aa11bb22-cc33-dd44-ee55-ff6677889900',
  postId: 'a3f1c2d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d',
  content: 'Rooftop gets my vote 🙌',
  createdAt: '2026-06-24T10:02:00.000Z',
  author: {
    id: 'c2d3e4f5-a6b7-8c9d-0e1f-2a3b4c5d6e7f',
    name: 'Asha Rao',
    avatarUrl: 'https://cdn.example.com/users/.../avatar/xyz.jpg?X-Amz-Signature=...',
  },
};

/** A cursor-paginated page of comments — the shape returned by `listComments`. */
export const COMMENT_PAGE_EXAMPLE = {
  comments: [COMMENT_EXAMPLE],
  nextCursor: '2026-06-24T10:02:00.000Z',
};

/** Trending topics — the shape returned by `trendingTopics`. */
export const TRENDING_TOPICS_EXAMPLE = [
  { topic: 'Saturday Meetup', postCount: 12 },
  { topic: 'Hackathon', postCount: 8 },
];

/** Generic success acknowledgement returned by engagement / mutation endpoints. */
export const SUCCESS_EXAMPLE = { success: true };
