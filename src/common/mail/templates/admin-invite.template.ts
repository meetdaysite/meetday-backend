// CITY_ADMIN is surfaced to users simply as "Admin" everywhere else in the product (it's a
// full-access role, not scoped to any city concept) — mirror that here instead of the raw enum.
export function toRoleLabel(name: string): string {
  if (name === 'CITY_ADMIN') return 'Admin';
  return name
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

export function adminInviteTemplate(
  recipientEmail: string,
  roleName: string,
  resetLink: string,
): string {
  const roleLabel = toRoleLabel(roleName);
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>You've been invited to join Meetday as ${roleLabel}</h2>
      <p>Hi,</p>
      <p>You have been invited to the Meetday admin team as a <strong>${roleLabel}</strong>.</p>
      <p>Your account has been created for <strong>${recipientEmail}</strong>. Before you can log in, you must set your password using the button below.</p>
      <br/>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${resetLink}"
           style="background-color: #4F46E5; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: bold; display: inline-block;">
          Set Your Password
        </a>
      </div>
      <p style="color: #6B7280; font-size: 14px;">
        This link will take you to the Meetday admin portal where you can set a password for your account.
        If you did not expect this invitation, you can safely ignore this email.
      </p>
      <br/>
      <p>The Meetday Team</p>
    </div>
  `;
}
