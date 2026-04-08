export function subscriptionActivatedTemplate(
  hostName: string,
  plan: string,
  billingCycle: string,
): string {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Subscription Activated</h2>
      <p>Hi ${hostName},</p>
      <p>Your <strong>${plan}</strong> plan (${billingCycle.toLowerCase()} billing) is now active on Meetday.</p>
      <p>You can now host ticketed events with a reduced platform fee of <strong>15%</strong>.</p>
      <p>Manage your subscription from your host dashboard.</p>
      <br/>
      <p>The Meetday Team</p>
    </div>
  `;
}
