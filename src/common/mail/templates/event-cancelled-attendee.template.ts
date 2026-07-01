export function eventCancelledAttendeeTemplate(
  firstName: string,
  eventTitle: string,
  cancellationReason: string,
  refundAmountRupees: number,
): string {
  const formatted = refundAmountRupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const refundLine =
    refundAmountRupees > 0
      ? `<p>A full refund of <strong>₹${formatted}</strong> has been initiated to your original payment method and should arrive within 3–5 business days.</p>`
      : `<p>As your tickets were free, no refund is required.</p>`;
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Event Cancelled — ${eventTitle}</h2>
      <p>Hi ${firstName},</p>
      <p>We're sorry to inform you that <strong>${eventTitle}</strong> has been cancelled.</p>
      <p><em>Reason: ${cancellationReason}</em></p>
      ${refundLine}
      <br/>
      <p>We're sorry for the disruption. We hope to see you at another Meetday event soon!</p>
      <p>— The Meetday Team</p>
    </div>
  `;
}
