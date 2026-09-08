export function kycVerifiedTemplate(hostName: string): string {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>KYC Verified</h2>
      <p>Hi ${hostName},</p>
      <p>Good news — your KYC (PAN and bank account details) has been reviewed and verified by our team.</p>
      <p>You're all set to receive payouts on Meetday.</p>
      <br/>
      <p>The Meetday Team</p>
    </div>
  `;
}
