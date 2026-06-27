import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';

// Razorpay Payouts webhook payload shape (subset we care about)
export class PayoutWebhookDto {
  @IsString()
  @IsIn(['payout.processed', 'payout.failed', 'payout.reversed', 'payout.queued', 'payout.pending'])
  event: string;

  @IsObject()
  payload: {
    payout: {
      entity: {
        id: string;
        reference_id?: string; // our payoutId (set as reference_id when creating)
        status: string;
        failure_reason?: string;
        utr?: string; // bank transaction reference
      };
    };
  };

  @IsString()
  @IsOptional()
  account_id?: string;
}
