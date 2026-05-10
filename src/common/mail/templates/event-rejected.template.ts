export function eventRejectedTemplate(hostName: string, eventTitle: string, remark: string): string {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Event Listing Update</h2>
      <p>Hi ${hostName},</p>
      <p>After reviewing your event <strong>${eventTitle}</strong>, we are unable to approve it at this time.</p>
      <p><strong>Remark:</strong> ${remark}</p>
      <p>You can edit your event from your host dashboard and resubmit it for review once the above has been addressed.</p>
      <p>If you have any questions, please reach out to our support team.</p>
      <br/>
      <p>The Meetday Team</p>
    </div>
  `;
}
