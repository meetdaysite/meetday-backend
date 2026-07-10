export function scannerInviteTemplate(
  staffName: string,
  eventTitle: string,
  scannerUrl: string,
  expiresAt: Date,
): string {
  const expiryFormatted = expiresAt.toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  });

  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>You've been assigned as a ticket scanner for ${eventTitle}</h2>
      <p>Hi ${staffName},</p>
      <p>
        You have been added as a ticket checker for the event <strong>${eventTitle}</strong>.
        Use the button below to open your scanner — no login required.
      </p>
      <br/>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${scannerUrl}"
           style="background-color: #4F46E5; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: bold; display: inline-block;">
          Open Ticket Scanner
        </a>
      </div>
      <p style="color: #6B7280; font-size: 14px;">
        This link is personal to you and expires on <strong>${expiryFormatted} IST</strong>.
        Do not share it with others. If you were not expecting this, you can safely ignore this email.
      </p>
      <br/>
      <p>The Meetday Team</p>
    </div>
  `;
}
