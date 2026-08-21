// Fixed 5% Meetday commission + 3% payment transaction fee on the sponsorship amount. GST is
// charged on (amount + platform fee + transaction fee) — same taxable-value convention used for
// ticket orders (see OrdersService) — and falls back to 18% if the `gst_rate` platform config
// isn't set. Shared between SponsorshipService (actually charges this) and AdminService (just
// displays it) so the two never drift apart.
export const SPONSORSHIP_PLATFORM_FEE_RATE = 0.05;
export const SPONSORSHIP_TRANSACTION_FEE_RATE = 0.03;
export const DEFAULT_SPONSORSHIP_GST_RATE = 0.18;

export function computeDealPaymentBreakdown(sponsorshipAmount: number, gstRate: number) {
  const platformFeeAmount = Math.round(sponsorshipAmount * SPONSORSHIP_PLATFORM_FEE_RATE * 100) / 100;
  const transactionFeeAmount = Math.round(sponsorshipAmount * SPONSORSHIP_TRANSACTION_FEE_RATE * 100) / 100;
  const taxAmount = Math.round((sponsorshipAmount + platformFeeAmount + transactionFeeAmount) * gstRate * 100) / 100;
  const totalAmount = Math.round((sponsorshipAmount + platformFeeAmount + transactionFeeAmount + taxAmount) * 100) / 100;
  return { platformFeeAmount, transactionFeeAmount, taxAmount, totalAmount };
}
