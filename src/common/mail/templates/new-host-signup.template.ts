export function newHostSignupTemplate(hostName: string, email: string): string {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>New Host Registered</h2>
      <p>A new host has just signed up on Meetday:</p>
      <p><strong>${hostName}</strong> (${email})</p>
      <br/>
      <p>The Meetday Team</p>
    </div>
  `;
}
