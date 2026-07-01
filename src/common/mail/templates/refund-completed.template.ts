export function refundCompletedTemplate(
  firstName: string,
  amountRupees: number,
  eventTitle: string,
): string {
  const formatted = amountRupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Refund Processed — Meetday</h2>
      <p>Hi ${firstName},</p>
      <p>Your refund of <strong>₹${formatted}</strong> for <strong>${eventTitle}</strong> has been successfully processed.</p>
      <p>The amount has been sent back to your original payment method and should reflect within 1–2 business days.</p>
      <br/>
      <p>We hope to see you at a future Meetday event!</p>
      <p>— The Meetday Team</p>
    </div>
  `;
}
