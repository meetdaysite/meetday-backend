export function ticketConfirmationTemplate(
  eventTitle: string,
  opts: { hasInvoice?: boolean } = {},
): string {
  const attachmentLine = opts.hasInvoice
    ? 'Your booking is confirmed! Find your ticket and tax invoice attached as PDFs.'
    : "You're all set! Find your ticket attached as a PDF.";
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>You're going to ${eventTitle}!</h2>
      <p>Hi there,</p>
      <p>${attachmentLine}</p>
      <p>See you at the event!</p>
      <br/>
      <p>— The Meetday Team</p>
    </div>
  `;
}
