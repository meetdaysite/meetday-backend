export function eventVenueChangedTemplate(
  firstName: string,
  eventTitle: string,
  venueName: string | null,
  fullAddress: string | null,
  city: string | null,
): string {
  const locationLines = [
    venueName ? `<p style="margin: 4px 0;"><strong>${venueName}</strong></p>` : '',
    fullAddress ? `<p style="margin: 4px 0;">${fullAddress}</p>` : '',
    city ? `<p style="margin: 4px 0;">${city}</p>` : '',
  ]
    .filter(Boolean)
    .join('');

  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Venue changed — ${eventTitle}</h2>
      <p>Hi ${firstName},</p>
      <p>Please note that the venue for <strong>${eventTitle}</strong> has been updated. Do check the new location before you head out:</p>
      <div style="background: #f5f5f5; border-radius: 8px; padding: 12px 16px; margin: 12px 0;">
        ${locationLines || '<p style="margin: 4px 0;">See the event page for the new location.</p>'}
      </div>
      <p>The date and time are unchanged. If the new location doesn't work for you, you can cancel your booking under the event's refund policy from your tickets.</p>
      <br/>
      <p>Thanks for your understanding,</p>
      <p>— The Meetday Team</p>
    </div>
  `;
}
