export function errorAlertTemplate(context: string, message: string): string {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Unexpected Error — Meetday</h2>
      <p>An unexpected error occurred in: <strong>${context}</strong></p>
      <pre style="background: #f5f5f5; padding: 12px; border-radius: 6px; white-space: pre-wrap; font-size: 13px;">${message}</pre>
      <br/>
      <p>The Meetday Team</p>
    </div>
  `;
}
