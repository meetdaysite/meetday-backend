export function teamInviteTemplate(
  inviterName: string,
  accountName: string,
  accountTypeLabel: string,
  signupUrl: string,
): string {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Join ${accountName}'s Dashboard on Meetday</h2>
      <p>Hi,</p>
      <p><strong>${inviterName}</strong> has invited you to join <strong>${accountName}</strong>'s ${accountTypeLabel} account on Meetday, with full access to the dashboard.</p>
      <p>Sign up with this email address to be automatically added.</p>
      <br/>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${signupUrl}"
           style="background-color: #4F46E5; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: bold; display: inline-block;">
          Sign Up
        </a>
      </div>
      <p style="color: #6B7280; font-size: 14px;">
        If you did not expect this invitation, you can safely ignore this email.
      </p>
      <br/>
      <p>The Meetday Team</p>
    </div>
  `;
}
