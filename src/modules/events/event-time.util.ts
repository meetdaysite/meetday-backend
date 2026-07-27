/**
 * Shared "has this event ended?" logic. Previously duplicated (inconsistently — some call
 * sites only checked `eventDate`, ignoring `startTime`/`endTime` entirely; the admin dashboard
 * compared `endTime` strings like "10:00 PM" against a 24-hour clock string) across reviews,
 * payouts, the host dashboard, check-in, and the admin dashboard.
 */

export interface EventTimeFields {
  eventDate: Date | null;
  /** Last day for multi-day events. Null ⇒ single-day: the event ends on `eventDate`. */
  endDate?: Date | null;
  startTime?: string | null;
  endTime?: string | null;
}

/** Parses a time-of-day string ("10:00 PM", "22:00", "9:30am") into 24-hour hours/minutes. */
export function parseTimeOfDay(value: string): { hours: number; minutes: number } | null {
  const match = value.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const meridiem = match[3]?.toUpperCase();
  if (meridiem === 'PM' && hours !== 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return null;

  return { hours, minutes };
}

/** The instant the event starts. Falls back to the start of `eventDate`'s day if `startTime` is missing/malformed. */
export function getEventStartAt(event: EventTimeFields): Date | null {
  if (!event.eventDate) return null;
  const start = new Date(event.eventDate);
  const parsed = event.startTime ? parseTimeOfDay(event.startTime) : null;
  if (parsed) start.setHours(parsed.hours, parsed.minutes, 0, 0);
  else start.setHours(0, 0, 0, 0);
  return start;
}

/**
 * The instant the event ends.
 *  - Multi-day: anchored to `endDate` (+ `endTime`, or end-of-day if `endTime` is missing/malformed).
 *  - Single-day (`endDate` null): anchored to `eventDate`. If the end clock time lands at or before
 *    the start clock time, the event crosses midnight (e.g. a 10 PM–2 AM club night) — roll the end
 *    forward one day. An explicit `endDate` is always trusted and never rolled.
 */
export function getEventEndAt(event: EventTimeFields): Date | null {
  if (!event.eventDate) return null;
  const end = new Date(event.endDate ?? event.eventDate);
  const parsed = event.endTime ? parseTimeOfDay(event.endTime) : null;
  if (parsed) end.setHours(parsed.hours, parsed.minutes, 0, 0);
  else end.setHours(23, 59, 59, 999);

  if (!event.endDate && parsed) {
    const start = getEventStartAt(event);
    if (start && end <= start) end.setDate(end.getDate() + 1);
  }
  return end;
}

/** True once the event's actual end instant has passed. False (not "unknown") if `eventDate` is missing. */
export function hasEventEnded(event: EventTimeFields, reference: Date = new Date()): boolean {
  const end = getEventEndAt(event);
  return end !== null && end <= reference;
}

/** True if `reference` falls between the event's start and end instants. */
export function isEventLiveNow(event: EventTimeFields, reference: Date = new Date()): boolean {
  const start = getEventStartAt(event);
  const end = getEventEndAt(event);
  if (!start || !end) return false;
  return start <= reference && reference <= end;
}
