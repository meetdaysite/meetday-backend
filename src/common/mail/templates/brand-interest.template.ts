export function brandInterestTemplate(
  communityName: string,
  proposalName: string,
  brandName: string,
  brandEmail: string,
  categories: string[],
  socialLinks: Record<string, string | undefined>,
): string {
  const categoryList = categories.length ? categories.join(', ') : '—';
  const linksHtml =
    Object.entries(socialLinks)
      .filter(([, v]) => !!v)
      .map(([k, v]) => `<li>${k}: <a href="${v}">${v}</a></li>`)
      .join('') || '<li>—</li>';

  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>A Brand Is Interested In A Sponsorship Proposal</h2>
      <p><strong>Community:</strong> ${communityName}</p>
      <p><strong>Proposal:</strong> ${proposalName}</p>
      <hr/>
      <p><strong>Interested brand</strong></p>
      <ul>
        <li>Name: ${brandName}</li>
        <li>Email: ${brandEmail}</li>
        <li>Categories: ${categoryList}</li>
      </ul>
      <p>Links:</p>
      <ul>${linksHtml}</ul>
      <br/>
      <p>The Meetday Team</p>
    </div>
  `;
}
