export function ticketConfirmationTemplate(eventTitle: string): string {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>You're going to ${eventTitle}!</h2>
      <p>Hi there,</p>
      <p>Your booking is confirmed! Find your tickets attached as a PDF.</p>
      <p>See you at the event!</p>
      <br/>
      <p>— The Meetday Team</p>
    </div>
  `;
}
