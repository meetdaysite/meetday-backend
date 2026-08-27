// 3% payment transaction fee on the sponsorship amount — no platform fee. GST is charged on
// (amount + transaction fee) — same taxable-value convention used for ticket orders (see
// OrdersService) — and falls back to 18% if the `gst_rate` platform config isn't set. Shared
// between SponsorshipService (actually charges this) and AdminService (just displays it) so the
// two never drift apart.
export const SPONSORSHIP_TRANSACTION_FEE_RATE = 0.03;
export const DEFAULT_SPONSORSHIP_GST_RATE = 0.18;

export function computeDealPaymentBreakdown(sponsorshipAmount: number, gstRate: number) {
  const transactionFeeAmount = Math.round(sponsorshipAmount * SPONSORSHIP_TRANSACTION_FEE_RATE * 100) / 100;
  const taxAmount = Math.round((sponsorshipAmount + transactionFeeAmount) * gstRate * 100) / 100;
  const totalAmount = Math.round((sponsorshipAmount + transactionFeeAmount + taxAmount) * 100) / 100;
  return { platformFeeAmount: null as number | null, transactionFeeAmount, taxAmount, totalAmount };
}

// Manual/offline override (admin marks a deal Paid outside Razorpay) — GST is charged on the
// sponsorship amount ONLY (no transaction fee added to the taxable value, unlike the online
// flow above), and the transaction fee is excluded from the total since no gateway fee was
// actually incurred.
export function computeOfflineDealPaymentBreakdown(sponsorshipAmount: number, gstRate: number, transactionFeeAmount: number) {
  const taxAmount = Math.round(sponsorshipAmount * gstRate * 100) / 100;
  const totalAmount = Math.round((sponsorshipAmount + taxAmount) * 100) / 100;
  return { platformFeeAmount: null as number | null, transactionFeeAmount, taxAmount, totalAmount };
}
