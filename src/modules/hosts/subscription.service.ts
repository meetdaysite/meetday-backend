import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Razorpay = require('razorpay');
import { BillingCycle, HostPlan } from '@prisma/client';

export interface CreateRazorpaySubscriptionParams {
  plan: HostPlan;
  billingCycle: BillingCycle;
  amountInPaise: number;
  hostEmail: string;
  hostProfileId: string;
}

export interface RazorpaySubscriptionResult {
  razorpayPlanId: string;
  razorpaySubscriptionId: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
}

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);
  private readonly razorpay: any;

  constructor(private readonly configService: ConfigService) {
    this.razorpay = new Razorpay({
      key_id: this.configService.get<string>('razorpay.keyId'),
      key_secret: this.configService.get<string>('razorpay.keySecret'),
    });
  }

  async createPlanAndSubscription(
    params: CreateRazorpaySubscriptionParams,
  ): Promise<RazorpaySubscriptionResult> {
    const { plan, billingCycle, amountInPaise, hostEmail } = params;
    const period = billingCycle === BillingCycle.YEARLY ? 'yearly' : 'monthly';
    const totalCount = billingCycle === BillingCycle.YEARLY ? 1 : 12;

    this.logger.log(`Creating Razorpay plan for ${plan} (${billingCycle})`);

    const razorpayPlan = await this.razorpay.plans.create({
      period,
      interval: 1,
      item: {
        name: `Meetday ${plan} Plan`,
        amount: amountInPaise,
        currency: 'INR',
      },
    });

    const subscription = await this.razorpay.subscriptions.create({
      plan_id: razorpayPlan.id,
      total_count: totalCount,
      quantity: 1,
      notify_info: { notify_email: hostEmail },
    });

    const currentPeriodStart = new Date();
    const currentPeriodEnd = subscription.current_end
      ? new Date(subscription.current_end * 1000)
      : new Date(currentPeriodStart.getTime() + (billingCycle === BillingCycle.YEARLY ? 365 : 30) * 24 * 60 * 60 * 1000);

    return {
      razorpayPlanId: razorpayPlan.id,
      razorpaySubscriptionId: subscription.id,
      currentPeriodStart,
      currentPeriodEnd,
    };
  }

  async cancelSubscription(razorpaySubscriptionId: string): Promise<void> {
    this.logger.log(`Cancelling Razorpay subscription: ${razorpaySubscriptionId}`);
    await this.razorpay.subscriptions.cancel(razorpaySubscriptionId, {
      cancel_at_cycle_end: 1,
    });
  }
}
