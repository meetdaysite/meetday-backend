import { EventsCompletionCron } from './events-completion.cron';

const DAY = 24 * 60 * 60 * 1000;

function makePrisma() {
  return {
    event: {
      findMany: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  } as any;
}

describe('EventsCompletionCron', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let cron: EventsCompletionCron;

  beforeEach(() => {
    prisma = makePrisma();
    cron = new EventsCompletionCron(prisma);
    jest.clearAllMocks();
    prisma.event.updateMany.mockResolvedValue({ count: 0 });
  });

  it('flips only the ended events to COMPLETED', async () => {
    const ended = {
      id: 'ended',
      eventDate: new Date(Date.now() - 2 * DAY),
      endDate: null,
      startTime: '07:00 PM',
      endTime: '10:00 PM',
    };
    // Multi-day event that started yesterday but runs until tomorrow — a DB candidate (eventDate <= now)
    // that has NOT ended yet; the JS filter must exclude it.
    const stillRunning = {
      id: 'running',
      eventDate: new Date(Date.now() - 1 * DAY),
      endDate: new Date(Date.now() + 1 * DAY),
      startTime: '10:00 AM',
      endTime: '10:00 PM',
    };
    prisma.event.findMany.mockResolvedValue([ended, stillRunning]);
    prisma.event.updateMany.mockResolvedValue({ count: 1 });

    const result = await cron.completeEndedEvents();

    expect(prisma.event.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['ended'] }, status: 'PUBLISHED' },
      data: { status: 'COMPLETED' },
    });
    expect(result).toEqual({ completed: 1 });
  });

  it('flips an overnight event only after its rolled end passes', async () => {
    // Ended at 2 AM "yesterday-night" → rolled to this morning, already past.
    const overnight = {
      id: 'overnight',
      eventDate: new Date(Date.now() - 1 * DAY),
      endDate: null,
      startTime: '10:00 PM',
      endTime: '02:00 AM',
    };
    prisma.event.findMany.mockResolvedValue([overnight]);
    prisma.event.updateMany.mockResolvedValue({ count: 1 });

    await cron.completeEndedEvents();

    expect(prisma.event.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['overnight'] }, status: 'PUBLISHED' } }),
    );
  });

  it('does nothing when no candidate has ended', async () => {
    prisma.event.findMany.mockResolvedValue([]);
    const result = await cron.completeEndedEvents();
    expect(prisma.event.updateMany).not.toHaveBeenCalled();
    expect(result).toEqual({ completed: 0 });
  });

  it('queries only PUBLISHED events whose start day has arrived', async () => {
    prisma.event.findMany.mockResolvedValue([]);
    await cron.completeEndedEvents();
    const arg = prisma.event.findMany.mock.calls[0][0];
    expect(arg.where.status).toBe('PUBLISHED');
    expect(arg.where.eventDate.lte).toBeInstanceOf(Date);
  });
});
