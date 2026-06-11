import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CROSSED_PATHS_THRESHOLD,
  EVENT_SETTLE_HOURS,
  diffNewlyCrossed,
  pairKey,
} from './graph.constants';
import { edgeRecomputeSql } from './graph.sql';

@Injectable()
export class GraphService {
  private readonly logger = new Logger(GraphService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly notificationsService: NotificationsService,
    @InjectQueue('graph') private readonly graphQueue: Queue,
  ) {}

  // ─── Scheduling ──────────────────────────────────────────────────────────────

  @Cron(CronExpression.EVERY_HOUR)
  async enqueueSettledEvents() {
    const cutoff = new Date(Date.now() - EVENT_SETTLE_HOURS * 60 * 60 * 1000);
    const events = await this.prisma.event.findMany({
      where: {
        status: 'PUBLISHED',
        eventDate: { lt: cutoff },
        graphProcessedAt: null,
      },
      select: { id: true },
      take: 50,
    });

    for (const event of events) {
      await this.graphQueue.add(
        'recompute-event-edges',
        { eventId: event.id, notify: true },
        { removeOnComplete: true, attempts: 3 },
      );
    }

    if (events.length > 0) this.logger.log(`Enqueued edge computation for ${events.length} settled event(s)`);
  }

  // ─── Edge computation ────────────────────────────────────────────────────────

  /**
   * Recomputes graph edges between all participants of an event, from their full
   * shared history. Idempotent — counters are derived, never incremented blindly.
   * When `notify` is true, fires "crossed paths" nudges for pairs whose
   * co-attendance count crossed the threshold in this run.
   */
  async recomputeEdgesForEvent(eventId: string, notify = false): Promise<{ participants: number }> {
    const participantIds = await this.getEventParticipantIds(eventId);

    if (participantIds.length >= 2) {
      const prevCrossed = notify ? await this.getCrossedPairKeys(participantIds) : new Set<string>();

      await this.recomputeEdgesForUsers(participantIds);

      if (notify) {
        const nowCrossed = await this.getCrossedPairKeys(participantIds);
        const newlyCrossed = diffNewlyCrossed(prevCrossed, nowCrossed);
        for (const key of newlyCrossed) {
          const [userAId, userBId] = key.split('|');
          await this.sendCrossedPathsNudge(userAId, userBId).catch((err) =>
            this.logger.error(`Failed to send crossed-paths nudge for pair ${key}`, err),
          );
        }
      }
    }

    await this.prisma.event.update({
      where: { id: eventId },
      data: { graphProcessedAt: new Date() },
    });

    return { participants: participantIds.length };
  }

  /**
   * Set-based recompute of every edge among `userIds` from confirmed orders on
   * ended, published events. Counters and weight are fully rewritten, so this is
   * safe to re-run any number of times.
   */
  async recomputeEdgesForUsers(userIds: string[]): Promise<number> {
    if (userIds.length < 2) return 0;
    return this.prisma.$executeRaw(edgeRecomputeSql(userIds));
  }

  // ─── Surface A: social proximity on event pages ──────────────────────────────

  /**
   * "People you've crossed paths with are going to this" — the requesting user's
   * graph connections among the event's confirmed attendees. PRIVATE profiles are
   * never surfaced.
   */
  async getSocialProximity(userId: string, eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, status: true },
    });
    if (!event || event.status !== 'PUBLISHED') throw new NotFoundException('Event not found');

    const attendeeIds = (await this.getEventParticipantIds(eventId)).filter((id) => id !== userId);
    if (attendeeIds.length === 0) {
      return { knownAttendeeCount: 0, avatars: [], strongestTies: [] };
    }

    const edges = await this.prisma.userConnection.findMany({
      where: {
        OR: [
          { userAId: userId, userBId: { in: attendeeIds } },
          { userBId: userId, userAId: { in: attendeeIds } },
        ],
      },
      orderBy: { weight: 'desc' },
    });
    if (edges.length === 0) {
      return { knownAttendeeCount: 0, avatars: [], strongestTies: [] };
    }

    const counterpartIds = edges.map((e) => (e.userAId === userId ? e.userBId : e.userAId));
    const visibleIds = await this.filterVisibleUserIds(counterpartIds);
    const visibleEdges = edges.filter((e) =>
      visibleIds.has(e.userAId === userId ? e.userBId : e.userAId),
    );

    const topIds = visibleEdges.slice(0, 5).map((e) => (e.userAId === userId ? e.userBId : e.userAId));
    const users = await this.prisma.user.findMany({
      where: { id: { in: topIds } },
      select: { id: true, firstName: true, avatarUrl: true },
    });
    const userById = new Map(users.map((u) => [u.id, u]));

    const avatars = (
      await Promise.all(
        topIds
          .map((id) => userById.get(id)?.avatarUrl)
          .filter((url): url is string => !!url)
          .map((url) => this.storageService.getPresignedDownloadUrl(url).catch(() => null)),
      )
    ).filter((url): url is string => url !== null);

    const strongestTies = visibleEdges.slice(0, 3).map((e) => {
      const otherId = e.userAId === userId ? e.userBId : e.userAId;
      return {
        firstName: userById.get(otherId)?.firstName ?? 'Someone',
        sharedEventCount: e.coAttendCount,
      };
    });

    return { knownAttendeeCount: visibleEdges.length, avatars, strongestTies };
  }

  // ─── Internal / debug queries ────────────────────────────────────────────────

  async getConnections(userId: string, limit = 50) {
    const edges = await this.prisma.userConnection.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      orderBy: { weight: 'desc' },
      take: limit,
    });

    return edges.map((e) => ({
      otherUserId: e.userAId === userId ? e.userBId : e.userAId,
      weight: e.weight,
      coAttendCount: e.coAttendCount,
      verifiedCoAttendCount: e.verifiedCoAttendCount,
      groupBookingCount: e.groupBookingCount,
      sharedHostCount: e.sharedHostCount,
      sharedCategoryCount: e.sharedCategoryCount,
      firstCoAttendedAt: e.firstCoAttendedAt,
      lastCoAttendedAt: e.lastCoAttendedAt,
      computedAt: e.computedAt,
    }));
  }

  // ─── Surface C: crossed-paths nudge ──────────────────────────────────────────

  private async sendCrossedPathsNudge(userAId: string, userBId: string): Promise<void> {
    const users = await this.prisma.user.findMany({
      where: { id: { in: [userAId, userBId] }, isActive: true },
      select: {
        id: true,
        firstName: true,
        attendeeProfile: { select: { privacy: true } },
      },
    });
    if (users.length !== 2) return;

    // Awareness only, both directions — so both parties must be discoverable.
    if (users.some((u) => u.attendeeProfile?.privacy === 'PRIVATE')) return;

    const edge = await this.prisma.userConnection.findUnique({
      where: { userAId_userBId: { userAId, userBId } },
      select: { coAttendCount: true },
    });
    if (!edge) return;

    const [a, b] = users[0].id === userAId ? [users[0], users[1]] : [users[1], users[0]];

    await Promise.all([
      this.notificationsService.create(
        a.id,
        'crossed_paths',
        'You keep crossing paths!',
        `You and ${b.firstName} have now been at ${edge.coAttendCount} events together. Looks like your circles overlap.`,
        { otherUserId: b.id, sharedEventCount: edge.coAttendCount },
      ),
      this.notificationsService.create(
        b.id,
        'crossed_paths',
        'You keep crossing paths!',
        `You and ${a.firstName} have now been at ${edge.coAttendCount} events together. Looks like your circles overlap.`,
        { otherUserId: a.id, sharedEventCount: edge.coAttendCount },
      ),
    ]);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /** Distinct resolved platform users with a confirmed order for the event. */
  private async getEventParticipantIds(eventId: string): Promise<string[]> {
    const [attendeeRows, orderRows] = await Promise.all([
      this.prisma.orderAttendee.findMany({
        where: {
          userId: { not: null },
          orderItem: { order: { eventId, status: 'CONFIRMED' } },
        },
        select: { userId: true },
        distinct: ['userId'],
      }),
      // Buyers on legacy orders whose lead attendee row predates identity resolution
      this.prisma.order.findMany({
        where: { eventId, status: 'CONFIRMED' },
        select: { userId: true },
        distinct: ['userId'],
      }),
    ]);

    return [
      ...new Set([
        ...attendeeRows.map((r) => r.userId!),
        ...orderRows.map((r) => r.userId),
      ]),
    ];
  }

  /** Pair keys among `userIds` whose co-attendance count is at/over the nudge threshold. */
  private async getCrossedPairKeys(userIds: string[]): Promise<Set<string>> {
    const rows = await this.prisma.userConnection.findMany({
      where: {
        userAId: { in: userIds },
        userBId: { in: userIds },
        coAttendCount: { gte: CROSSED_PATHS_THRESHOLD },
      },
      select: { userAId: true, userBId: true },
    });
    return new Set(rows.map((r) => pairKey(r.userAId, r.userBId)));
  }

  /** Drops users whose attendee profile is PRIVATE (missing profile = visible). */
  private async filterVisibleUserIds(userIds: string[]): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const privateProfiles = await this.prisma.attendeeProfile.findMany({
      where: { userId: { in: userIds }, privacy: 'PRIVATE' },
      select: { userId: true },
    });
    const privateSet = new Set(privateProfiles.map((p) => p.userId));
    return new Set(userIds.filter((id) => !privateSet.has(id)));
  }
}
