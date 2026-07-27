import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { EventChanges } from '../events/event-changes.util';

// Event media lives under exactly these two prefixes and nowhere else shares them:
//  - events/{eventId}/...                       (media on an existing event)
//  - hosts/{hostProfileId}/event-media/...      (pre-creation uploads, before the event row exists)
const EVENTS_PREFIX = 'events/';
const HOSTS_PREFIX = 'hosts/';
// The hosts/ prefix also holds hosts/{id}/documents/ (KYC files). Only ever treat the
// event-media subtree as sweepable — never documents.
const HOST_EVENT_MEDIA_RE = /^hosts\/[^/]+\/event-media\//;

export interface MediaGcResult {
  scanned: number;
  orphaned: number;
  deleted: number;
  failed: number;
  dryRun: boolean;
  skipped?: 'empty-referenced-set' | 'over-cap';
}

/**
 * Reclaims orphaned event-media objects from GCS — files that no longer belong to any event.
 *
 * Orphan sources it cleans: abandoned pre-creation uploads, media replaced on a draft edit or an
 * approved revision, media of deleted drafts, and rejected/superseded revision uploads.
 *
 * Safety model (see the two env knobs MEDIA_GC_DRY_RUN / MEDIA_GC_GRACE_DAYS):
 *  - Scoped strictly to the two event-media prefixes; documents/avatars/PDFs are never listed for deletion.
 *  - An object is deleted only if it is BOTH unreferenced AND older than the grace period (by GCS
 *    timeCreated) — the age gate removes any freshly-uploaded-not-yet-saved race.
 *  - Aborts if the referenced set is empty (a query bug would otherwise nuke everything) or if the
 *    candidate count exceeds the per-run cap.
 *  - Dry-run logs what it would delete and deletes nothing.
 */
@Injectable()
export class MediaGcService {
  private readonly logger = new Logger(MediaGcService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly auditLog: AuditLogService,
    private readonly config: ConfigService,
  ) {}

  async sweep(): Promise<MediaGcResult> {
    const dryRun = this.config.get<boolean>('mediaGc.dryRun') ?? true;
    const graceDays = this.config.get<number>('mediaGc.graceDays') ?? 7;
    const maxDeletes = this.config.get<number>('mediaGc.maxDeletesPerRun') ?? 1000;
    const cutoff = new Date(Date.now() - graceDays * 24 * 60 * 60 * 1000);

    // 1) Allow-list: every key still referenced by an event. Nothing here is ever deleted.
    const referenced = await this.buildReferencedKeySet();

    // Safety: an empty allow-list almost certainly means a broken query — refuse to delete anything.
    if (referenced.size === 0) {
      this.logger.warn('media-gc: referenced key set is empty — aborting to avoid mass deletion');
      return { scanned: 0, orphaned: 0, deleted: 0, failed: 0, dryRun, skipped: 'empty-referenced-set' };
    }

    // 2) List candidate objects under the event-media prefixes (documents filtered out of hosts/).
    const [eventsObjs, hostsObjs] = await Promise.all([
      this.storage.listObjects(EVENTS_PREFIX),
      this.storage.listObjects(HOSTS_PREFIX),
    ]);
    const candidates = [
      ...eventsObjs,
      ...hostsObjs.filter((o) => HOST_EVENT_MEDIA_RE.test(o.key)),
    ];

    // 3) Orphan = unreferenced AND older than the grace period.
    const orphans = candidates.filter((o) => !referenced.has(o.key) && o.timeCreated < cutoff);

    const scanned = candidates.length;
    const orphaned = orphans.length;

    // Safety cap: an implausibly large batch is a red flag — abort instead of deleting.
    if (orphaned > maxDeletes) {
      this.logger.warn(
        `media-gc: ${orphaned} orphans exceed the per-run cap of ${maxDeletes} — aborting. Investigate before raising MEDIA_GC_MAX_DELETES_PER_RUN.`,
      );
      this.audit({ scanned, orphaned, deleted: 0, failed: 0, dryRun, skipped: 'over-cap' });
      return { scanned, orphaned, deleted: 0, failed: 0, dryRun, skipped: 'over-cap' };
    }

    if (dryRun) {
      this.logger.log(
        `media-gc DRY-RUN: scanned ${scanned} object(s), would delete ${orphaned} orphan(s).` +
          (orphaned ? ` Sample: ${orphans.slice(0, 10).map((o) => o.key).join(', ')}` : ''),
      );
      this.audit({ scanned, orphaned, deleted: 0, failed: 0, dryRun: true });
      return { scanned, orphaned, deleted: 0, failed: 0, dryRun: true };
    }

    const { deleted, failed } = await this.storage.deleteObjects(orphans.map((o) => o.key));
    this.logger.log(`media-gc: scanned ${scanned}, deleted ${deleted}, failed ${failed}`);
    this.audit({ scanned, orphaned, deleted, failed, dryRun: false });
    return { scanned, orphaned, deleted, failed, dryRun: false };
  }

  /** Keys that must be preserved: all live event media + proposed media in still-pending revisions. */
  private async buildReferencedKeySet(): Promise<Set<string>> {
    const set = new Set<string>();

    const media = await this.prisma.eventMedia.findMany({ select: { url: true } });
    for (const m of media) set.add(m.url);

    // Proposed media in PENDING revisions isn't applied yet, but it's live intent — never delete it.
    const pending = await this.prisma.eventRevision.findMany({
      where: { status: 'PENDING' },
      select: { changes: true },
    });
    for (const r of pending) {
      const changes = r.changes as unknown as EventChanges;
      if (Array.isArray(changes.media)) {
        for (const m of changes.media) if (m?.key) set.add(m.key);
      }
    }

    return set;
  }

  private audit(result: MediaGcResult): void {
    this.auditLog.log({
      actorRole: 'SYSTEM',
      action: 'MEDIA_GC',
      entityType: 'MEDIA',
      entityId: 'media-gc',
      metadata: { ...result },
    });
  }
}
