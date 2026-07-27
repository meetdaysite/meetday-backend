import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PayoutsService } from './payouts.service';
import { PrismaService } from '../../prisma/prisma.service';
import { APPROVED_EVENT_STATUSES } from '../events/event-time.util';

@Injectable()
export class PayoutsCron {
  private readonly logger = new Logger(PayoutsCron.name);

  constructor(
    private readonly payoutsService: PayoutsService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  // Runs daily at 9:30 AM IST (4:00 AM UTC)
  @Cron('0 4 * * *', { name: 'process-due-payouts', timeZone: 'UTC' })
  async processDuePayouts() {
    const xConfigured = !!this.configService.get<string>('razorpay.xAccountNumber');
    const meetdayHostProfileId = this.configService.get<string>('houseAccount.meetdayHostProfileId');

    this.logger.log(
      xConfigured
        ? 'Starting daily payout batch job'
        : 'Payout batch: RAZORPAY_X_ACCOUNT_NUMBER not set — computing settlement records only, no funds transferred',
    );

    // Find all PUBLISHED events that have concluded and have confirmed unpaid orders.
    // The service method enforces the hold-days window and other eligibility checks.
    // Meetday's own house account is excluded — its revenue never leaves the platform,
    // so there's nothing to pay out (see prisma/scripts/seed-meetday-host.ts).
    const eligibleEvents = await this.prisma.event.findMany({
      where: {
        // COMPLETED events are the common case here (payouts run after the event ends); include both
        // so a payout is never skipped just because the completion cron already flipped the status.
        status: { in: APPROVED_EVENT_STATUSES },
        eventDate: { not: null },
        orders: { some: { status: 'CONFIRMED', payoutLineItem: null } },
        ...(meetdayHostProfileId && { hostProfileId: { not: meetdayHostProfileId } }),
      },
      select: { id: true },
    });

    this.logger.log(`Found ${eligibleEvents.length} events with pending order payouts to evaluate`);

    let computed = 0;
    let triggered = 0;
    let skipped = 0;
    let errors = 0;

    for (const event of eligibleEvents) {
      try {
        const payout = await this.payoutsService.computeAndCreatePayout(event.id);
        if (!payout) {
          skipped++;
          continue;
        }

        computed++;

        // Only trigger the live Razorpay transfer if X account is configured.
        // Without it, PENDING payouts stay in the ledger and are triggered once X is set up.
        if (payout.status === 'PENDING' && xConfigured) {
          await this.payoutsService.triggerPayout(payout.id);
          triggered++;
        }
      } catch (err) {
        errors++;
        this.logger.error(`Payout batch error for event ${event.id}: ${err.message}`, err.stack);
      }
    }

    this.logger.log(
      `Payout batch complete — computed: ${computed}, triggered: ${triggered}, skipped: ${skipped}, errors: ${errors}`,
    );
  }
}
