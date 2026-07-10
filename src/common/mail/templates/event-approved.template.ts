export function eventApprovedTemplate(hostName: string, eventTitle: string): string {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Your Event Has Been Approved!</h2>
      <p>Hi ${hostName},</p>
      <p>Great news! Your event <strong>${eventTitle}</strong> has been reviewed and approved.</p>
      <p>It is now live on Meetday and visible to attendees.</p>
      <p>You can manage your event from your host dashboard.</p>
      <br/>
      <p>The Meetday Team</p>
    </div>
  `;
}
