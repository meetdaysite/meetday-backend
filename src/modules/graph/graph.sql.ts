import { Prisma } from '@prisma/client';
import { GRAPH_WEIGHTS } from './graph.constants';

/**
 * Set-based recompute of UserConnection edges from confirmed orders on ended,
 * published events. Counters and weight are fully rewritten from history, so the
 * statement is idempotent. Pass `userIds` to scope the recompute to pairs within
 * that set (per-event jobs); omit it to recompute the entire graph (backfill).
 */
export function edgeRecomputeSql(userIds?: string[]): Prisma.Sql {
  const userFilter = userIds
    ? Prisma.sql`oa."userId" = ANY(${userIds})`
    : Prisma.sql`oa."userId" IS NOT NULL`;

  return Prisma.sql`
    WITH att AS (
      SELECT oa."userId"                           AS user_id,
             o."eventId"                           AS event_id,
             bool_or(oa."checkedInAt" IS NOT NULL) AS checked_in,
             array_agg(DISTINCT oi."orderId")      AS order_ids
      FROM order_attendees oa
      JOIN order_items oi ON oi.id = oa."orderItemId"
      JOIN orders o       ON o.id  = oi."orderId"
      JOIN events e       ON e.id  = o."eventId"
      WHERE o.status = 'CONFIRMED'
        AND ${userFilter}
        AND e.status IN ('PUBLISHED', 'COMPLETED')
        AND e."eventDate" IS NOT NULL
        AND e."eventDate" < NOW()
      GROUP BY oa."userId", o."eventId"
    ),
    pair_events AS (
      SELECT a.user_id                       AS user_a,
             b.user_id                       AS user_b,
             a.event_id,
             (a.checked_in AND b.checked_in) AS both_checked,
             (a.order_ids && b.order_ids)    AS same_order
      FROM att a
      JOIN att b ON a.event_id = b.event_id AND a.user_id < b.user_id
    ),
    agg AS (
      SELECT pe.user_a,
             pe.user_b,
             COUNT(*)::int                                AS co_attend,
             COUNT(*) FILTER (WHERE pe.both_checked)::int AS verified,
             COUNT(*) FILTER (WHERE pe.same_order)::int   AS grouped,
             COUNT(DISTINCT e."hostProfileId")::int       AS hosts,
             (COUNT(DISTINCT e."categoryId") FILTER (WHERE e."categoryId" IS NOT NULL))::int AS cats,
             MIN(e."eventDate")                           AS first_co,
             MAX(e."eventDate")                           AS last_co
      FROM pair_events pe
      JOIN events e ON e.id = pe.event_id
      GROUP BY pe.user_a, pe.user_b
    )
    INSERT INTO user_connections
      ("userAId", "userBId", weight, "coAttendCount", "verifiedCoAttendCount",
       "groupBookingCount", "sharedHostCount", "sharedCategoryCount",
       "firstCoAttendedAt", "lastCoAttendedAt", "computedAt")
    SELECT user_a,
           user_b,
           co_attend * ${GRAPH_WEIGHTS.CO_ATTEND}
             + verified * ${GRAPH_WEIGHTS.VERIFIED_CO_ATTEND}
             + grouped * ${GRAPH_WEIGHTS.GROUP_BOOKING}
             + GREATEST(hosts - 1, 0) * ${GRAPH_WEIGHTS.HOST_DIVERSITY}
             + GREATEST(cats - 1, 0) * ${GRAPH_WEIGHTS.CATEGORY_DIVERSITY},
           co_attend, verified, grouped, hosts, cats, first_co, last_co, NOW()
    FROM agg
    ON CONFLICT ("userAId", "userBId") DO UPDATE SET
      weight                  = EXCLUDED.weight,
      "coAttendCount"         = EXCLUDED."coAttendCount",
      "verifiedCoAttendCount" = EXCLUDED."verifiedCoAttendCount",
      "groupBookingCount"     = EXCLUDED."groupBookingCount",
      "sharedHostCount"       = EXCLUDED."sharedHostCount",
      "sharedCategoryCount"   = EXCLUDED."sharedCategoryCount",
      "firstCoAttendedAt"     = EXCLUDED."firstCoAttendedAt",
      "lastCoAttendedAt"      = EXCLUDED."lastCoAttendedAt",
      "computedAt"            = NOW()
  `;
}
