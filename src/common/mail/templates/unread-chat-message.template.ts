export function unreadChatMessageTemplate(name: string, unreadCount: number, ctaUrl: string): string {
  const messageWord = unreadCount > 1 ? `${unreadCount} unread messages` : 'an unread message';
  const ctaLabel = unreadCount > 1 ? 'View Messages' : 'View Message';

  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>You have ${messageWord} waiting</h2>
      <p>Hey ${name}, you have ${messageWord} waiting in your Meetday dashboard.</p>
      <p style="margin: 24px 0;">
        <a href="${ctaUrl}" style="background:#EE2C2C;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">
          ${ctaLabel}
        </a>
      </p>
      <p>The Meetday Team</p>
    </div>
  `;
}
