export function announcementTemplate(subject: string, message: string): string {
  // Message comes from an admin textarea (plain text) — preserve line breaks, escape HTML to avoid injection.
  const escaped = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>');

  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>${subject}</h2>
      <p>${escaped}</p>
      <br/>
      <p>The Meetday Team</p>
    </div>
  `;
}
