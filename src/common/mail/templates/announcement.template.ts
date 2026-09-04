export function announcementTemplate(
  subject: string,
  message: string,
  attachments?: Array<{ name: string; size?: number; type?: string; url?: string }>,
): string {
  // If message contains rich HTML tags, sanitize script/event handlers and render formatted HTML with email client styles.
  // If message is plain text, escape HTML and convert line breaks to <br/>.
  const hasHtml = /<[a-z][\s\S]*>/i.test(message);

  let formattedContent = '';
  if (hasHtml) {
    formattedContent = message
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
      .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
      .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '')
      .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
      .replace(/on\w+\s*=\s*[^\s>]+/gi, '');
  } else {
    formattedContent = message
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br/>');
  }

  const attachmentsHtml =
    attachments && attachments.length > 0
      ? `
        <div style="margin-top: 24px; padding: 16px; background-color: #f3f4f6; border: 2px solid #000000; border-radius: 12px;">
          <p style="font-size: 12px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.05em; color: #111827; margin: 0 0 10px 0;">
            📎 Attached Files (${attachments.length}):
          </p>
          <ul style="margin: 0; padding-left: 18px; list-style-type: disc;">
            ${attachments
              .map(
                (att) => `
                <li style="font-size: 13px; font-weight: 700; color: #1f2937; margin-bottom: 4px;">
                  ${att.name} ${att.size ? `<span style="font-size: 11px; color: #6b7280; font-weight: normal;">(${Math.round(att.size / 1024)} KB)</span>` : ''}
                </li>
              `,
              )
              .join('')}
          </ul>
        </div>
      `
      : '';

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111827; background-color: #f9fafb; margin: 0; padding: 24px 16px; }
          .container { max-width: 600px; margin: 0 auto; background: #ffffff; border: 3px solid #000000; border-radius: 20px; padding: 32px 28px; box-shadow: 5px 5px 0px 0px #000000; }
          .header-badge { display: inline-block; background-color: #EE2C2C; color: #ffffff; font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.06em; padding: 4px 12px; border-radius: 9999px; margin-bottom: 20px; border: 2px solid #000000; }
          h1, h2, h3 { color: #000000; font-weight: 900; margin-top: 0; }
          h1 { font-size: 24px; line-height: 1.3; margin-bottom: 16px; }
          h2 { font-size: 20px; line-height: 1.35; margin-bottom: 14px; }
          h3 { font-size: 16px; line-height: 1.4; margin-bottom: 12px; }
          p { font-size: 14px; line-height: 1.65; color: #374151; margin: 0 0 16px 0; }
          ul { list-style-type: disc; margin: 0 0 16px 0; padding-left: 24px; }
          ul ul { list-style-type: circle; margin: 4px 0 4px 0; padding-left: 20px; }
          ul ul ul { list-style-type: square; margin: 4px 0 4px 0; padding-left: 20px; }
          ol { list-style-type: decimal; margin: 0 0 16px 0; padding-left: 24px; }
          ol ol { list-style-type: lower-alpha; margin: 4px 0 4px 0; padding-left: 20px; }
          ol ol ol { list-style-type: lower-roman; margin: 4px 0 4px 0; padding-left: 20px; }
          li { font-size: 14px; line-height: 1.65; color: #374151; margin-bottom: 4px; }
          blockquote { border-left: 4px solid #EE2C2C; background-color: #fef2f2; margin: 16px 0; padding: 12px 18px; font-style: italic; color: #4b5563; border-radius: 0 8px 8px 0; }
          a { color: #EE2C2C; text-decoration: underline; font-weight: 700; }
          hr { border: 0; border-top: 2px solid #e5e7eb; margin: 24px 0; }
          .footer { margin-top: 32px; padding-top: 20px; border-top: 2px solid #f3f4f6; font-size: 12px; color: #6b7280; text-align: center; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header-badge">Announcement</div>
          ${subject ? `<h1>${subject}</h1>` : ''}
          <div class="content">
            ${formattedContent}
          </div>
          ${attachmentsHtml}
          <div class="footer">
            <p style="margin: 0; font-weight: 800; color: #111827;">The Meetday Team</p>
            <p style="margin: 4px 0 0 0; font-size: 11px; color: #9ca3af;">You are receiving this announcement as a member of the Meetday network.</p>
          </div>
        </div>
      </body>
    </html>
  `;
}
