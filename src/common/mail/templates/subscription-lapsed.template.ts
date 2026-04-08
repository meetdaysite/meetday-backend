export function subscriptionLapsedTemplate(hostName: string, plan: string): string {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Subscription Expired</h2>
      <p>Hi ${hostName},</p>
      <p>Your <strong>${plan}</strong> plan on Meetday has expired.</p>
      <p>Your account has been moved back to the <strong>Discover</strong> plan. Ticketed events will now incur a <strong>20% platform fee</strong>.</p>
      <p>Renew your subscription from your host dashboard to restore your previous benefits.</p>
      <br/>
      <p>The Meetday Team</p>
    </div>
  `;
}
