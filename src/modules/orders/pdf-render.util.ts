import * as puppeteer from 'puppeteer';

// Shared HTML-escaper for values interpolated into the ticket/invoice templates.
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// Renders a self-contained HTML string to a PDF Buffer via headless Chromium.
// All assets must be inlined (data URIs) — the page is set directly, not served.
export async function renderHtmlToPdf(
  html: string,
  opts: { width: string; height: string },
): Promise<Buffer> {
  const [pdf] = await renderHtmlsToPdfs([html], opts);
  return pdf;
}

// Renders several HTML strings to PDFs reusing a single browser instance — one
// Chromium launch for the whole batch instead of one per document. Buffers are
// returned in the same order as the input HTMLs.
export async function renderHtmlsToPdfs(
  htmls: string[],
  opts: { width: string; height: string },
): Promise<Buffer[]> {
  if (htmls.length === 0) return [];

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const buffers: Buffer[] = [];
    for (const html of htmls) {
      const page = await browser.newPage();
      try {
        await page.setContent(html, { waitUntil: 'load' });
        const pdf = await page.pdf({
          width: opts.width,
          height: opts.height,
          printBackground: true,
        });
        buffers.push(Buffer.from(pdf));
      } finally {
        await page.close();
      }
    }
    return buffers;
  } finally {
    await browser.close();
  }
}
