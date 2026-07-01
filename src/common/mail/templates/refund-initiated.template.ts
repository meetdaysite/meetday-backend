export function refundInitiatedTemplate(
  firstName: string,
  amountRupees: number,
  eventTitle: string,
): string {
  const formatted = amountRupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Refund Initiated — Meetday</h2>
      <p>Hi ${firstName},</p>
      <p>We've received your cancellation request for <strong>${eventTitle}</strong>.</p>
      <p>A refund of <strong>₹${formatted}</strong> has been initiated to your original payment method.</p>
      <p>Refunds typically take <strong>3–5 business days</strong> to appear in your account depending on your bank.</p>
      <br/>
      <p>If you have any questions, please reach out through the Meetday app.</p>
      <p>— The Meetday Team</p>
    </div>
  `;
}
