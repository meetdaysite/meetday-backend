import {
  deriveEventStatus,
  getEventEndAt,
  getEventStartAt,
  hasEventEnded,
  isEventLiveNow,
  parseTimeOfDay,
} from './event-time.util';
import { EventStatus } from '@prisma/client';

// Local-time constructors (month is 0-indexed → 6 = July) so they line up with the setHours()
// arithmetic inside the helper, which also operates in local time.
const jul26 = new Date(2026, 6, 26);
const jul28 = new Date(2026, 6, 28);

describe('parseTimeOfDay', () => {
  it.each([
    ['10:00 PM', 22, 0],
    ['01:00 PM', 13, 0],
    ['12:00 AM', 0, 0],
    ['12:00 PM', 12, 0],
    ['22:00', 22, 0],
    ['9:30 am', 9, 30],
  ])('parses %s', (input, h, m) => {
    expect(parseTimeOfDay(input)).toEqual({ hours: h, minutes: m });
  });

  it.each(['invalid', '25:00', '10:75', ''])('rejects %s', (input) => {
    expect(parseTimeOfDay(input)).toBeNull();
  });
});

describe('getEventEndAt', () => {
  it('returns null when eventDate is missing', () => {
    expect(getEventEndAt({ eventDate: null, endTime: '10:00 PM' })).toBeNull();
  });

  it('single-day: anchors end to eventDate + endTime', () => {
    const end = getEventEndAt({ eventDate: jul26, startTime: '07:00 PM', endTime: '10:00 PM' })!;
    expect(end).toEqual(new Date(2026, 6, 26, 22, 0, 0, 0));
  });

  it('single-day missing endTime: falls back to end-of-day', () => {
    const end = getEventEndAt({ eventDate: jul26, startTime: '07:00 PM' })!;
    expect(end).toEqual(new Date(2026, 6, 26, 23, 59, 59, 999));
  });

  it('overnight: rolls end forward a day when end clock time <= start clock time', () => {
    // 10 PM → 2 AM club night, no explicit endDate
    const end = getEventEndAt({ eventDate: jul26, startTime: '10:00 PM', endTime: '02:00 AM' })!;
    expect(end).toEqual(new Date(2026, 6, 27, 2, 0, 0, 0));
  });

  it('multi-day: anchors end to explicit endDate and never rolls it', () => {
    const end = getEventEndAt({ eventDate: jul26, endDate: jul28, startTime: '10:00 AM', endTime: '02:00 AM' })!;
    expect(end).toEqual(new Date(2026, 6, 28, 2, 0, 0, 0));
  });
});

describe('hasEventEnded', () => {
  const single = { eventDate: jul26, startTime: '07:00 PM', endTime: '10:00 PM' };

  it('false before the event ends (same morning)', () => {
    expect(hasEventEnded(single, new Date(2026, 6, 26, 6, 0))).toBe(false);
  });

  it('false while the event is running', () => {
    expect(hasEventEnded(single, new Date(2026, 6, 26, 21, 0))).toBe(false);
  });

  it('true after the event ends', () => {
    expect(hasEventEnded(single, new Date(2026, 6, 26, 23, 0))).toBe(true);
  });

  it('overnight: not ended at 11 PM on the start day', () => {
    const overnight = { eventDate: jul26, startTime: '10:00 PM', endTime: '02:00 AM' };
    expect(hasEventEnded(overnight, new Date(2026, 6, 26, 23, 0))).toBe(false);
    expect(hasEventEnded(overnight, new Date(2026, 6, 27, 3, 0))).toBe(true);
  });

  it('multi-day: not ended midway through the run', () => {
    const festival = { eventDate: jul26, endDate: jul28, startTime: '10:00 AM', endTime: '10:00 PM' };
    expect(hasEventEnded(festival, new Date(2026, 6, 27, 12, 0))).toBe(false);
    expect(hasEventEnded(festival, new Date(2026, 6, 28, 23, 0))).toBe(true);
  });

  it('false when eventDate is missing (not "unknown")', () => {
    expect(hasEventEnded({ eventDate: null })).toBe(false);
  });
});

describe('isEventLiveNow', () => {
  const single = { eventDate: jul26, startTime: '07:00 PM', endTime: '10:00 PM' };

  it('false before start', () => {
    expect(isEventLiveNow(single, new Date(2026, 6, 26, 6, 0))).toBe(false);
  });

  it('true between start and end', () => {
    expect(isEventLiveNow(single, new Date(2026, 6, 26, 20, 0))).toBe(true);
  });

  it('false after end', () => {
    expect(isEventLiveNow(single, new Date(2026, 6, 26, 23, 0))).toBe(false);
  });

  it('overnight: live at 1 AM the next day', () => {
    const overnight = { eventDate: jul26, startTime: '10:00 PM', endTime: '02:00 AM' };
    expect(isEventLiveNow(overnight, new Date(2026, 6, 27, 1, 0))).toBe(true);
  });
});

describe('getEventStartAt', () => {
  it('missing startTime falls back to start of day', () => {
    expect(getEventStartAt({ eventDate: jul26 })!).toEqual(new Date(2026, 6, 26, 0, 0, 0, 0));
  });
});

describe('deriveEventStatus', () => {
  const single = { eventDate: jul26, startTime: '07:00 PM', endTime: '10:00 PM' };

  it.each([EventStatus.DRAFT, EventStatus.UNDER_REVIEW, EventStatus.CANCELLED, EventStatus.COMPLETED])(
    'passes %s through unchanged',
    (status) => {
      expect(deriveEventStatus({ ...single, status })).toBe(status);
    },
  );

  it('PUBLISHED before the event → PUBLISHED', () => {
    expect(deriveEventStatus({ ...single, status: EventStatus.PUBLISHED }, new Date(2026, 6, 26, 6, 0))).toBe(
      EventStatus.PUBLISHED,
    );
  });

  it('PUBLISHED during the event → LIVE', () => {
    expect(deriveEventStatus({ ...single, status: EventStatus.PUBLISHED }, new Date(2026, 6, 26, 20, 0))).toBe('LIVE');
  });

  it('PUBLISHED after the event ends → COMPLETED (pre-cron safety net)', () => {
    expect(deriveEventStatus({ ...single, status: EventStatus.PUBLISHED }, new Date(2026, 6, 26, 23, 0))).toBe(
      EventStatus.COMPLETED,
    );
  });
});
