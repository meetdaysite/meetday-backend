import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { MediaGcService } from './media-gc.service';

@Injectable()
export class MediaGcCron {
  private readonly logger = new Logger(MediaGcCron.name);

  constructor(
    private readonly mediaGc: MediaGcService,
    private readonly config: ConfigService,
  ) {}

  // Daily at 03:00 UTC (08:30 IST) — off-peak, staggered from the 04:00 UTC payout batch.
  @Cron('0 3 * * *', { name: 'media-gc-sweep', timeZone: 'UTC' })
  async run(): Promise<void> {
    if (!(this.config.get<boolean>('mediaGc.enabled') ?? true)) {
      this.logger.log('media-gc: disabled via MEDIA_GC_ENABLED=false — skipping');
      return;
    }
    try {
      await this.mediaGc.sweep();
    } catch (err) {
      this.logger.error(`media-gc sweep failed: ${(err as Error).message}`, (err as Error).stack);
    }
  }
}
