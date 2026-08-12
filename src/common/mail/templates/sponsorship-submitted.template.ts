export function sponsorshipSubmittedTemplate(hostName: string, proposalName: string): string {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>New Sponsorship Proposal Pending Review</h2>
      <p>Host <strong>${hostName}</strong> has submitted a sponsorship proposal for review:</p>
      <p><strong>"${proposalName}"</strong></p>
      <p>Please review it in the admin panel.</p>
      <br/>
      <p>The Meetday Team</p>
    </div>
  `;
}
