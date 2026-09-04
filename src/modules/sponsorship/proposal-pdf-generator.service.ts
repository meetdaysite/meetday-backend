import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { escapeHtml, renderHtmlToPdf } from '../orders/pdf-render.util';
import { MEETDAY_LOGO_DATA_URI } from '../../common/assets/meetday-logo.base64';
import { StorageService } from '../../common/storage/storage.service';
import { DeckSlideDto } from './dto/deck-slide.dto';
import { DeckFontVibe, DeckTheme, FinalizeProposalDeckDto, FinalizeProposalDeckResponseDto } from './dto/finalize-proposal-deck.dto';

const FONT_STACKS: Record<DeckFontVibe, { heading: string; body: string }> = {
  // Generic CSS font families (serif/sans-serif/monospace) render distinctly even without
  // custom font files installed in the container — real visual difference, no network fonts.
  MODERN_SANS: { heading: 'sans-serif', body: 'sans-serif' },
  CLASSIC_SERIF: { heading: 'serif', body: 'serif' },
  TECH_GEOMETRIC: { heading: 'monospace', body: 'sans-serif' },
  MINIMALIST: { heading: 'sans-serif', body: 'sans-serif' },
};

type SlideBg = 'light' | 'dark';

// AI-planned, theme/brand-aware sponsorship pitch deck — renders a fixed set of slide LAYOUTS
// (cover/value-prop/stat-highlight/bullet-list/pricing/closing), each theme-aware (light/dark),
// with the community/brand's own logo + colors as the primary identity and a subtle "Powered by
// Meetday.ai" footer. Output is uploaded straight to storage (no direct download) — the docKey
// is meant to be attached to the sponsorship proposal record, replacing a manual file upload.
@Injectable()
export class ProposalPdfGeneratorService {
  constructor(private readonly storageService: StorageService) {}

  async finalizeDeck(dto: FinalizeProposalDeckDto): Promise<FinalizeProposalDeckResponseDto> {
    const [darkBgLogo, lightBgLogo] = await Promise.all([
      this.keyToDataUri(dto.primaryLogoKey),
      this.keyToDataUri(dto.secondaryLogoKey),
    ]);
    const usingFallbackLogo = !!(darkBgLogo || lightBgLogo) && !(darkBgLogo && lightBgLogo);
    const fallbackLogo = darkBgLogo ?? lightBgLogo ?? null;

    const total = dto.slides.length;
    const slidesHtml = dto.slides
      .map((slide, index) => {
        const bg = this.resolveSlideBg(dto.theme, slide.layout, index, total);
        const logo = bg === 'dark' ? (darkBgLogo ?? fallbackLogo) : (lightBgLogo ?? fallbackLogo);
        return this.renderSlide(slide, {
          bg,
          logo,
          logoNeedsChip: usingFallbackLogo && !!logo,
          index,
          total,
          isLast: index === total - 1,
        });
      })
      .join('');

    const fonts = FONT_STACKS[dto.fontVibe];
    const minimalist = dto.fontVibe === 'MINIMALIST';
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><style>
  * { box-sizing: border-box; }
  :root { --primary: ${escapeHtml(dto.primaryColor)}; --accent: ${escapeHtml(dto.accentColor)}; }
  body { margin: 0; font-family: ${fonts.body}; }
  .slide {
    width: 1280px; height: 720px; padding: ${minimalist ? '72px 96px' : '56px 72px'}; display: flex; flex-direction: column;
    break-after: page; page-break-after: always; position: relative;
  }
  .slide-last { break-after: auto; page-break-after: auto; }
  .slide.bg-light { background: #fff; color: #111; }
  .slide.bg-dark { background: #0B0B10; color: #fff; }
  .slide-header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 16px; margin-bottom: 36px;
    border-bottom: ${minimalist ? '1px solid currentColor' : '3px solid currentColor'}; opacity: 1; }
  .slide-header-inner { display: flex; align-items: center; gap: 14px; }
  .logo-chip { background: rgba(255,255,255,0.85); border-radius: 12px; padding: 6px 10px; display: inline-flex; align-items: center; }
  .bg-dark .logo-chip { background: rgba(255,255,255,0.12); }
  .logo { height: 34px; max-width: 160px; object-fit: contain; }
  .slide-label { font-size: 13px; font-weight: 900; text-transform: uppercase; letter-spacing: ${minimalist ? '0.16em' : '0.08em'}; opacity: 0.6; }
  .slide-body { flex: 1; display: flex; flex-direction: column; justify-content: center; }
  .slide-body h1 { font-family: ${fonts.heading}; font-size: 52px; font-weight: ${minimalist ? 300 : 900}; letter-spacing: -0.01em; margin: 0 0 12px; }
  .slide-body h2 { font-family: ${fonts.heading}; font-size: 34px; font-weight: ${minimalist ? 300 : 900}; letter-spacing: -0.01em; margin: 0 0 24px; color: var(--primary); }
  .bg-dark .slide-body h2 { color: var(--accent); }
  .slide-body .subtitle { font-size: 20px; font-weight: 600; opacity: 0.65; margin: 0; }
  .slide-body p { font-size: 22px; line-height: 1.6; margin: 0 0 16px; max-width: 980px; opacity: 0.9; }
  .stats-grid { display: flex; flex-wrap: wrap; gap: 20px; margin-top: 16px; }
  .stat-card { border: 2px solid var(--primary); border-radius: 18px; padding: 22px 28px; min-width: 180px; }
  .bg-dark .stat-card { border-color: var(--accent); }
  .stat-value { font-size: 40px; font-weight: 900; color: var(--primary); }
  .bg-dark .stat-value { color: var(--accent); }
  .stat-label { font-size: 14px; font-weight: 700; opacity: 0.6; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 4px; }
  .bullet-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 14px; }
  .bullet-list li { font-size: 22px; padding-left: 32px; position: relative; opacity: 0.9; }
  .bullet-list li::before { content: ''; position: absolute; left: 0; top: 10px; width: 12px; height: 12px; border-radius: 50%; background: var(--primary); }
  .bg-dark .bullet-list li::before { background: var(--accent); }
  .tiers { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 12px; }
  .tier { display: flex; align-items: center; gap: 10px; border: 2px solid var(--primary); border-radius: 16px; padding: 14px 22px; }
  .bg-dark .tier { border-color: var(--accent); }
  .tier-name { font-weight: 700; font-size: 20px; }
  .tier-price { font-weight: 900; font-size: 20px; color: var(--primary); }
  .bg-dark .tier-price { color: var(--accent); }
  .contact-block p { margin: 0 0 6px; }
  .contact-block .contact-label { opacity: 0.6; font-weight: 600; }
  .slide-footer { display: flex; align-items: center; justify-content: space-between; padding-top: 14px; margin-top: 20px;
    border-top: 1px solid currentColor; opacity: 0.55; font-size: 11px; }
  .powered-by { display: flex; align-items: center; gap: 6px; font-weight: 700; }
  .mini-logo { height: 14px; }
  .page-num { font-weight: 700; }
</style></head>
<body>
  ${slidesHtml}
</body>
</html>`;

    const buffer = await renderHtmlToPdf(html, { width: '1280px', height: '720px' });
    const key = `sponsorship-proposal-decks/${randomUUID()}.pdf`;
    await this.storageService.uploadBuffer(key, buffer, 'application/pdf');
    return { docKey: key, docName: 'sponsorship-proposal-deck.pdf', docType: 'application/pdf', docSize: buffer.length };
  }

  private resolveSlideBg(theme: DeckTheme, layout: DeckSlideDto['layout'], index: number, total: number): SlideBg {
    if (theme === 'LIGHT') return 'light';
    if (theme === 'DARK') return 'dark';
    // AUTO — dark bookends (cover + closing), light content in between.
    return layout === 'COVER' || layout === 'CLOSING_CONTACT' || index === total - 1 ? 'dark' : 'light';
  }

  private async keyToDataUri(key: string | undefined): Promise<string | null> {
    if (!key) return null;
    try {
      const url = await this.storageService.getPresignedDownloadUrl(key);
      const res = await fetch(url);
      if (!res.ok) return null;
      const contentType = res.headers.get('content-type') || 'image/png';
      const buf = Buffer.from(await res.arrayBuffer());
      return `data:${contentType};base64,${buf.toString('base64')}`;
    } catch {
      return null;
    }
  }

  private renderSlide(
    slide: DeckSlideDto,
    opts: { bg: SlideBg; logo: string | null; logoNeedsChip: boolean; index: number; total: number; isLast: boolean },
  ): string {
    const nl2p = (text?: string) =>
      text
        ? escapeHtml(text)
            .split(/\n+/)
            .map((line) => `<p>${line}</p>`)
            .join('')
        : '';

    const logoImg = opts.logo ? `<img class="logo" src="${opts.logo}" alt="Logo" />` : '';
    const logoBlock = opts.logoNeedsChip ? `<div class="logo-chip">${logoImg}</div>` : logoImg;

    let body = '';
    switch (slide.layout) {
      case 'COVER':
        body = `<h1>${escapeHtml(slide.title)}</h1>${slide.subtitle ? `<p class="subtitle">${escapeHtml(slide.subtitle)}</p>` : ''}`;
        break;
      case 'VALUE_PROP':
        body = `<h2>${escapeHtml(slide.title)}</h2>${nl2p(slide.body)}`;
        break;
      case 'STAT_HIGHLIGHT': {
        const stats = (slide.stats ?? [])
          .map(
            (s) => `<div class="stat-card"><div class="stat-value">${escapeHtml(s.value)}</div><div class="stat-label">${escapeHtml(s.label)}</div></div>`,
          )
          .join('');
        body = `<h2>${escapeHtml(slide.title)}</h2>${nl2p(slide.body)}<div class="stats-grid">${stats}</div>`;
        break;
      }
      case 'BULLET_LIST': {
        const items = (slide.bullets ?? []).map((b) => `<li>${escapeHtml(b)}</li>`).join('');
        body = `<h2>${escapeHtml(slide.title)}</h2><ul class="bullet-list">${items}</ul>`;
        break;
      }
      case 'PRICING_COMPARISON': {
        const tiers = (slide.pricingTiers ?? [])
          .map(
            (t) => `<div class="tier"><span class="tier-name">${escapeHtml(t.name)}</span><span class="tier-price">${escapeHtml(t.price.startsWith('₹') ? t.price : `₹${t.price}`)}</span></div>`,
          )
          .join('');
        body = `<h2>${escapeHtml(slide.title)}</h2><div class="tiers">${tiers}</div>`;
        break;
      }
      case 'CLOSING_CONTACT': {
        const contact = slide.contactName
          ? `<div class="contact-block" style="margin-top:24px">
              <p style="font-size:22px;font-weight:700">${escapeHtml(slide.contactName)}</p>
              ${slide.contactEmail ? `<p><span class="contact-label">Email:</span> ${escapeHtml(slide.contactEmail)}</p>` : ''}
              ${slide.contactPhone ? `<p><span class="contact-label">Phone:</span> ${escapeHtml(slide.contactPhone)}</p>` : ''}
            </div>`
          : '';
        body = `<h2>${escapeHtml(slide.title)}</h2>${nl2p(slide.body)}${contact}`;
        break;
      }
    }

    return `
      <section class="slide bg-${opts.bg}${opts.isLast ? ' slide-last' : ''}">
        <div class="slide-header">
          <div class="slide-header-inner">${logoBlock}</div>
        </div>
        <div class="slide-body">${body}</div>
        <div class="slide-footer">
          <span class="powered-by"><img class="mini-logo" src="${MEETDAY_LOGO_DATA_URI}" alt="Meetday" /> Powered by Meetday.ai</span>
          <span class="page-num">${opts.index + 1} / ${opts.total}</span>
        </div>
      </section>`;
  }
}

