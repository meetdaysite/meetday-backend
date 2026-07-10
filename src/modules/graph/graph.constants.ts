// Edge weight formula — weight is always recomputed from the counters, so these
// can be tuned freely; the next recompute job rewrites every affected edge.
//
//   weight = coAttendCount        * CO_ATTEND
//          + verifiedCoAttendCount * VERIFIED_CO_ATTEND
//          + groupBookingCount     * GROUP_BOOKING
//          + max(sharedHostCount - 1, 0)     * HOST_DIVERSITY
//          + max(sharedCategoryCount - 1, 0) * CATEGORY_DIVERSITY
export const GRAPH_WEIGHTS = {
  CO_ATTEND: 1.0,
  VERIFIED_CO_ATTEND: 2.0, // both parties actually checked in
  GROUP_BOOKING: 3.0, // booked on the same order — strongest signal
  HOST_DIVERSITY: 0.5, // co-attending across different hosts
  CATEGORY_DIVERSITY: 0.5, // co-attending across different categories
} as const;

// Co-attendance count at which the "crossed paths" nudge fires (once, on crossing).
export const CROSSED_PATHS_THRESHOLD = 3;

// How long after eventDate before edges are computed — leaves room for late
// check-ins (scanner sessions stay valid up to 1h after event end).
export const EVENT_SETTLE_HOURS = 24;

// Host audience intelligence — "community ready" heuristic.
export const COMMUNITY_READY_MIN_CORE = 8; // distinct repeat attendees needed
export const COMMUNITY_READY_MIN_ATTENDANCES = 3; // confirmed orders per core member

/** Canonical edge ordering — every pair is stored once with userAId < userBId. */
export function orderPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export function pairKey(a: string, b: string): string {
  const [x, y] = orderPair(a, b);
  return `${x}|${y}`;
}

/** Pairs present in `now` but not in `prev` — i.e. edges that just crossed the threshold. */
export function diffNewlyCrossed(prev: Set<string>, now: Set<string>): string[] {
  return [...now].filter((key) => !prev.has(key));
}
