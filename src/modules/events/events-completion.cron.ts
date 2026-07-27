import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { hasEventEnded } from './event-time.util';

/**
 * Flips PUBLISHED events to COMPLETED once their end instant has passed. `COMPLETED` is the durable,
 * one-way successor of `PUBLISHED` — see the completion-status design. The sweep is the transition
 * mechanism; read surfaces additionally derive COMPLETED on the fly (via {@link hasEventEnded}) so a
 * just-ended event displays correctly in the window before the next run.
 */
@Injectable()
export class EventsCompletionCron {
  private readonly logger = new Logger(EventsCompletionCron.name);
  private static readonly BATCH_SIZE = 200;

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_30_MINUTES, { name: 'complete-ended-events' })
  async completeEndedEvents(): Promise<{ completed: number }> {
    const now = new Date();

    // Candidates: published events whose start day has arrived. The precise "has it ended?" check
    // (endDate + endTime + overnight roll) can't be expressed in SQL against the string endTime, so
    // we resolve it in JS below.
    const candidates = await this.prisma.event.findMany({
      where: { status: EventStatus.PUBLISHED, eventDate: { lte: now } },
      select: { id: true, eventDate: true, endDate: true, startTime: true, endTime: true },
      take: EventsCompletionCron.BATCH_SIZE,
    });

    const endedIds = candidates.filter((e) => hasEventEnded(e, now)).map((e) => e.id);
    if (endedIds.length === 0) {
      this.logger.log('Completion sweep: no ended events to flip');
      return { completed: 0 };
    }

    // `status: PUBLISHED` in the where makes the flip race-safe and strictly one-way — a concurrently
    // cancelled event (now CANCELLED) is never touched.
    const { count } = await this.prisma.event.updateMany({
      where: { id: { in: endedIds }, status: EventStatus.PUBLISHED },
      data: { status: EventStatus.COMPLETED },
    });

    this.logger.log(`Completion sweep: marked ${count} event(s) COMPLETED`);
    return { completed: count };
  }
}
