export function kycFailedTemplate(hostName: string, reason: string | null): string {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>KYC Verification Failed</h2>
      <p>Hi ${hostName},</p>
      <p>Unfortunately, your KYC verification on Meetday could not be completed.</p>
      ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
      <p>You can reapply for KYC verification from your host dashboard.</p>
      <p>If you believe this is an error, please contact our support team.</p>
      <br/>
      <p>The Meetday Team</p>
    </div>
  `;
}
