export function communityProfileSubmittedTemplate(hostName: string, communityName: string): string {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>New Community Profile Pending Review</h2>
      <p>Host <strong>${hostName}</strong> has submitted a community profile for review:</p>
      <p><strong>"${communityName}"</strong></p>
      <p>Please review it in the admin panel.</p>
      <br/>
      <p>The Meetday Team</p>
    </div>
  `;
}
