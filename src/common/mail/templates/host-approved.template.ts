export function hostApprovedTemplate(hostName: string): string {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>You're Approved as a Meetday Host!</h2>
      <p>Hi ${hostName},</p>
      <p>Great news! Your host application has been reviewed and approved.</p>
      <p>You are now live on the <strong>Discover</strong> plan and can start hosting events on Meetday.</p>
      <br/>
      <p>Welcome to the Meetday host community!</p>
      <p>The Meetday Team</p>
    </div>
  `;
}
