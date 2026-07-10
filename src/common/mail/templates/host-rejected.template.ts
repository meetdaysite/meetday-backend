export function hostRejectedTemplate(hostName: string, reason: string): string {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Host Application Update</h2>
      <p>Hi ${hostName},</p>
      <p>After reviewing your host application, we are unable to approve it at this time.</p>
      <p><strong>Reason:</strong> ${reason}</p>
      <p>You may reapply from your dashboard once you have addressed the above.</p>
      <p>If you have questions, please reach out to our support team.</p>
      <br/>
      <p>The Meetday Team</p>
    </div>
  `;
}
