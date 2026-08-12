export function userActionTemplate(userLabel: string, method: string, path: string): string {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>User Action — Meetday</h2>
      <p><strong>${userLabel}</strong> performed an action:</p>
      <p><code>${method} ${path}</code></p>
      <br/>
      <p>The Meetday Team</p>
    </div>
  `;
}
