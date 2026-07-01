export function refundFailedTemplate(firstName: string, amountRupees: number): string {
  const formatted = amountRupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Refund Issue — Action Required</h2>
      <p>Hi ${firstName},</p>
      <p>We were unable to process your refund of <strong>₹${formatted}</strong> automatically.</p>
      <p>Our team has been notified and will manually process your refund within <strong>2 business days</strong>. You do not need to take any action.</p>
      <p>If you haven't heard from us within 2 business days, please contact us through the Meetday app.</p>
      <br/>
      <p>We apologise for the inconvenience.</p>
      <p>— The Meetday Team</p>
    </div>
  `;
}
