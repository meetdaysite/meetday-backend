import { Injectable, ServiceUnavailableException } from '@nestjs/common';
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

// Short "eyebrow" label shown above each content slide's heading — mirrors how a real pitch
// deck signposts each section. The 10-slide template order is fixed/deterministic (see
// ProposalDeckContentService.generatePlan), so index-based overrides safely disambiguate the
// 3 VALUE_PROP slides (Event Overview / About Host / Why Sponsor This) which share one layout.
const KICKER_BY_LAYOUT: Partial<Record<DeckSlideDto['layout'], string>> = {
  STAT_HIGHLIGHT: 'BY THE NUMBERS',
  BULLET_LIST: 'DELIVERABLES',
  PAST_SPONSORS: 'SOCIAL PROOF',
  PRICING_COMPARISON: 'PACKAGES & PRICING',
  CLOSING_CONTACT: "LET'S CONNECT",
};
const KICKER_BY_INDEX: Record<number, string> = { 1: 'THE EVENT', 2: 'ABOUT US', 4: 'WHY SPONSOR' };
function kickerFor(layout: DeckSlideDto['layout'], index: number): string {
  return KICKER_BY_INDEX[index] ?? KICKER_BY_LAYOUT[layout] ?? '';
}

// AI-planned, theme/brand-aware sponsorship pitch deck — renders a fixed set of slide LAYOUTS
// (cover/value-prop/stat-highlight/bullet-list/pricing/closing), each theme-aware (light/dark),
// with the community/brand's own logo + colors as the primary identity and a subtle "Powered by
// Meetday.ai" footer. Output is uploaded straight to storage (no direct download) — the docKey
// is meant to be attached to the sponsorship proposal record, replacing a manual file upload.
@Injectable()
export class ProposalPdfGeneratorService {
  constructor(private readonly storageService: StorageService) {}

  async finalizeDeck(dto: FinalizeProposalDeckDto): Promise<FinalizeProposalDeckResponseDto> {
    const [darkBgLogo, lightBgLogo, mediaAssetUris] = await Promise.all([
      this.keyToDataUri(dto.primaryLogoKey),
      this.keyToDataUri(dto.secondaryLogoKey),
      // 1 hero (cover) + up to 2 on "About Host" + up to 2 on "Why Sponsor This".
      Promise.all((dto.mediaAssetKeys ?? []).slice(0, 5).map((k) => this.keyToDataUri(k))),
    ]);
    const usingFallbackLogo = !!(darkBgLogo || lightBgLogo) && !(darkBgLogo && lightBgLogo);
    const fallbackLogo = darkBgLogo ?? lightBgLogo ?? null;
    const resolvedGalleryUris = mediaAssetUris.filter((u): u is string => !!u);
    const heroImageUri = resolvedGalleryUris[0] ?? null;
    const aboutGalleryUris = resolvedGalleryUris.slice(1, 3);
    const whySponsorGalleryUris = resolvedGalleryUris.slice(3, 5);

    // Past-sponsor logos need the same key -> data-URI treatment as the deck's own logos.
    const slidesWithResolvedLogos = await Promise.all(
      dto.slides.map(async (slide) => {
        if (slide.layout !== 'PAST_SPONSORS' || !slide.pastSponsors?.length) return slide;
        const resolved = await Promise.all(
          slide.pastSponsors.map(async (p) => ({ ...p, logoUri: await this.keyToDataUri(p.logoKey) })),
        );
        return { ...slide, resolvedPastSponsors: resolved };
      }),
    );

    const total = slidesWithResolvedLogos.length;
    const slidesHtml = slidesWithResolvedLogos
      .map((slide, index) => {
        const bg = this.resolveSlideBg(dto.theme, slide.layout, index, total);
        const logo = bg === 'dark' ? (darkBgLogo ?? fallbackLogo) : (lightBgLogo ?? fallbackLogo);
        const isBookend = index === 0 || index === total - 1;
        const rotatingPrimary = dto.primaryColors[index % dto.primaryColors.length];
        const rotatingAccent = dto.accentColors[index % dto.accentColors.length];
        const bgAccent = bg === 'dark' ? rotatingAccent : rotatingPrimary;
        return this.renderSlide(slide, {
          bg,
          bgColor: bg === 'dark' ? this.mix(bgAccent, [0, 0, 0], 0.82) : this.mix(bgAccent, [255, 255, 255], 0.94),
          primaryColor: rotatingPrimary,
          accentColor: rotatingAccent,
          logo,
          logoNeedsChip: usingFallbackLogo && !!logo,
          logoLarge: isBookend,
          index,
          total,
          isLast: index === total - 1,
          heroImageUri: index === 0 ? heroImageUri : null,
          // "About <Host>" (index 2) and "Why Sponsor This" (index 4) are fixed positions in
          // the 10-slide template — each gets up to 2 of the remaining brand images.
          galleryUris: index === 2 ? aboutGalleryUris : index === 4 ? whySponsorGalleryUris : [],
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
  body { margin: 0; font-family: ${fonts.body}; }
  .slide {
    width: 1280px; height: 720px; padding: ${minimalist ? '72px 96px' : '56px 72px'}; display: flex; flex-direction: column;
    break-after: page; page-break-after: always; position: relative;
  }
  .slide-last { break-after: auto; page-break-after: auto; }
  .slide.bg-light { color: #111; }
  .slide.bg-dark { color: #fff; }
  .slide-header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 16px; margin-bottom: 32px;
    border-bottom: ${minimalist ? '1px solid currentColor' : '3px solid currentColor'}; opacity: 1; position: relative; z-index: 1; }
  .slide-header-inner { display: flex; align-items: center; gap: 14px; }
  .logo-chip { background: rgba(255,255,255,0.85); border-radius: 12px; padding: 6px 10px; display: inline-flex; align-items: center; }
  .bg-dark .logo-chip { background: rgba(255,255,255,0.12); }
  .logo { height: 34px; max-width: 160px; object-fit: contain; }
  .logo-large { height: 90px; max-width: 320px; }
  .slide-label { font-size: 13px; font-weight: 900; text-transform: uppercase; letter-spacing: ${minimalist ? '0.16em' : '0.08em'}; opacity: 0.6; }
  .slide-body { flex: 1; display: flex; flex-direction: column; position: relative; z-index: 1; min-height: 0; }
  .kicker { display: inline-block; font-size: 14px; font-weight: 900; letter-spacing: 0.14em; color: var(--accent); margin-bottom: 10px; }
  .slide-body h1 { font-family: ${fonts.heading}; font-size: 56px; font-weight: ${minimalist ? 300 : 900}; letter-spacing: -0.01em; margin: 0 0 14px; line-height: 1.08; }
  .slide-body h2 { font-family: ${fonts.heading}; font-size: 36px; font-weight: ${minimalist ? 300 : 900}; letter-spacing: -0.01em; margin: 0 0 8px; line-height: 1.12; }
  .accent-rule { width: 64px; height: 5px; border-radius: 3px; background: var(--accent); margin: 0 0 22px; }
  .slide-body .subtitle { font-size: 21px; font-weight: 600; opacity: 0.7; margin: 0 0 8px; }
  .slide-body p { font-size: 21px; line-height: 1.65; margin: 0 0 14px; opacity: 0.9; }
  .meta-row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
  .meta-badge { display: inline-flex; align-items: center; font-size: 15px; font-weight: 700; padding: 8px 18px; border-radius: 999px;
    border: 2px solid currentColor; opacity: 0.9; }

  /* Two-column split used by COVER (hero image) and VALUE_PROP (brand gallery) slides —
     content on the left, visuals on the right, filling the full slide width instead of
     leaving dead space beside a centered text column. */
  .cover-grid, .content-grid { flex: 1; display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 56px; align-items: center; min-height: 0; }
  .cover-grid.no-image, .content-grid.full { grid-template-columns: 1fr; }
  .cover-grid .content-col, .content-grid .content-col { display: flex; flex-direction: column; justify-content: center; min-width: 0; }
  .visual-col { position: relative; height: 100%; min-height: 0; display: flex; flex-direction: column; gap: 16px; }
  .visual-frame { flex: 1; border-radius: 24px; display: flex; align-items: center; justify-content: center; overflow: hidden;
    background: color-mix(in srgb, var(--primary) 12%, transparent); border: 2px solid color-mix(in srgb, var(--primary) 30%, transparent); padding: 14px; min-height: 0; }
  .visual-frame img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .hero-image-frame { height: 100%; }

  /* Soft decorative shape fills the empty side of text-only slides so they don't look bare.
     Uses the accent color (usually the more vibrant of the two rotating palettes) rather than
     primary, since primary is sometimes a deliberately dark/near-black brand color that would
     otherwise look like a muddy gray wash instead of a colorful flourish. */
  .decor-shape { position: absolute; top: -20%; right: -14%; width: 34%; height: 75%; border-radius: 50%;
    background: color-mix(in srgb, var(--accent) 9%, transparent); z-index: -1; pointer-events: none; }
  .decor-shape::after { content: ''; position: absolute; bottom: -8%; left: 6%; width: 30%; height: 30%; border-radius: 50%;
    background: color-mix(in srgb, var(--primary) 8%, transparent); }

  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 20px; margin-top: 20px; }
  .stat-card { border: 2px solid var(--primary); border-radius: 18px; padding: 24px 26px; background: color-mix(in srgb, var(--primary) 6%, transparent); }
  .stat-value { font-size: 42px; font-weight: 900; color: var(--primary); }
  .stat-label { font-size: 14px; font-weight: 700; opacity: 0.65; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 6px; }
  .bullet-list { list-style: none; margin: 20px 0 0; padding: 0; display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px 32px; }
  .bullet-list li { font-size: 22px; padding: 16px 20px 16px 44px; position: relative; opacity: 0.95; border-radius: 14px;
    background: color-mix(in srgb, var(--primary) 6%, transparent); }
  .bullet-list li::before { content: ''; position: absolute; left: 18px; top: 24px; width: 12px; height: 12px; border-radius: 50%; background: var(--primary); }
  .tiers { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 18px; margin-top: 20px; }
  .tier { display: flex; flex-direction: column; gap: 6px; border: 2px solid var(--primary); border-radius: 18px; padding: 20px 24px;
    background: color-mix(in srgb, var(--primary) 6%, transparent); }
  .tier-name { font-weight: 700; font-size: 19px; opacity: 0.75; }
  .tier-price { font-weight: 900; font-size: 28px; color: var(--primary); }
  .contact-block p { margin: 0 0 8px; font-size: 22px; }
  .contact-block .contact-label { opacity: 0.6; font-weight: 600; }
  .sponsors-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 20px; margin-top: 20px; }
  .sponsor-card { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; border: 2px solid var(--primary);
    border-radius: 18px; padding: 24px; min-height: 120px; background: color-mix(in srgb, var(--primary) 6%, transparent); }
  .sponsor-logo { height: 44px; max-width: 130px; object-fit: contain; }
  .sponsor-name { font-weight: 700; font-size: 17px; }
  .sponsor-ref { font-size: 13px; opacity: 0.6; }
  .barter-badge { display: inline-block; margin-top: 16px; padding: 8px 18px; border-radius: 999px; font-size: 14px; font-weight: 700; background: var(--primary); color: #fff; }
  .deadline-note { font-size: 16px; opacity: 0.7; margin-top: 12px; }
  .slide-footer { display: flex; align-items: center; justify-content: space-between; padding-top: 14px; margin-top: 20px;
    border-top: 1px solid currentColor; opacity: 0.55; font-size: 11px; position: relative; z-index: 1; }
  .powered-by { display: flex; align-items: center; gap: 6px; font-weight: 700; }
  .mini-logo { height: 14px; }
  .progress-dots { display: flex; align-items: center; gap: 6px; }
  .progress-dots span { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: 0.3; }
  .progress-dots span.active { opacity: 1; background: var(--primary); width: 16px; border-radius: 4px; }
  .page-num { font-weight: 700; }
</style></head>
<body>
  ${slidesHtml}
</body>
</html>`;


    let buffer: Buffer;
    try {
      buffer = await renderHtmlToPdf(html, { width: '1280px', height: '720px' });
    } catch (err) {
      // Puppeteer/container crashes (e.g. transient memory pressure) surface as an opaque
      // "Connection closed" — translate to a clear, retryable error instead of a raw 500.
      throw new ServiceUnavailableException('Failed to render the proposal deck. Please try again in a moment.', {
        cause: err instanceof Error ? err : undefined,
      });
    }
    const key = `sponsorship-proposal-decks/${randomUUID()}.pdf`;
    const docName = 'sponsorship-proposal-deck.pdf';
    await this.storageService.uploadBuffer(key, buffer, 'application/pdf');
    // Deliberately NOT forcing Content-Disposition: attachment here — the deck is view-only
    // in-app (PdfViewer), never a direct download link.
    const docUrl = await this.storageService.getPresignedDownloadUrl(key);
    return { docKey: key, docName, docType: 'application/pdf', docSize: buffer.length, docUrl };
  }

  private resolveSlideBg(theme: DeckTheme, layout: DeckSlideDto['layout'], index: number, total: number): SlideBg {
    if (theme === 'LIGHT') return 'light';
    if (theme === 'DARK') return 'dark';
    // AUTO — dark bookends (cover + closing), light content in between.
    return layout === 'COVER' || layout === 'CLOSING_CONTACT' || index === total - 1 ? 'dark' : 'light';
  }

  // Caps embedded image size defensively — even though the frontend already enforces a 5MB
  // limit, an oversized image here (bypassed client check, or a very large SVG) could still
  // blow Puppeteer's container memory once several logos/media assets are all embedded into
  // one 10-slide document at once. Skips the image (renders without it) rather than crashing.
  private async keyToDataUri(key: string | undefined): Promise<string | null> {
    if (!key) return null;
    try {
      const url = await this.storageService.getPresignedDownloadUrl(key);
      const res = await fetch(url);
      if (!res.ok) return null;
      const contentType = res.headers.get('content-type') || 'image/png';
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 8 * 1024 * 1024) return null;
      return `data:${contentType};base64,${buf.toString('base64')}`;
    } catch {
      return null;
    }
  }

  private hexToRgb(hex: string): [number, number, number] {
    const clean = hex.replace('#', '');
    const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
    const int = parseInt(full, 16);
    return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
  }

  private rgbToHex(r: number, g: number, b: number): string {
    return (
      '#' +
      [r, g, b]
        .map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0'))
        .join('')
    );
  }

  // Blends a brand color toward a target (black for dark slides, white for light slides) instead
  // of using a fixed background — so a dark-themed slide is a tinted dark shade of the host's own
  // color palette, never plain black, and a light-themed slide gets a subtle brand-colored tint.
  private mix(hex: string, target: [number, number, number], ratio: number): string {
    const [r, g, b] = this.hexToRgb(hex);
    const [tr, tg, tb] = target;
    return this.rgbToHex(r + (tr - r) * ratio, g + (tg - g) * ratio, b + (tb - b) * ratio);
  }

  private renderSlide(
    slide: DeckSlideDto & { resolvedPastSponsors?: Array<{ name: string; projectReference?: string; logoUri: string | null }> },
    opts: {
      bg: SlideBg;
      bgColor: string;
      primaryColor: string;
      accentColor: string;
      logo: string | null;
      logoNeedsChip: boolean;
      logoLarge: boolean;
      index: number;
      total: number;
      isLast: boolean;
      heroImageUri: string | null;
      galleryUris: string[];
    },
  ): string {
    const nl2p = (text?: string) =>
      text
        ? escapeHtml(text)
            .split(/\n+/)
            .map((line) => `<p>${line}</p>`)
            .join('')
        : '';

    const logoImg = opts.logo ? `<img class="logo${opts.logoLarge ? ' logo-large' : ''}" src="${opts.logo}" alt="Logo" />` : '';
    const logoBlock = opts.logoNeedsChip ? `<div class="logo-chip">${logoImg}</div>` : logoImg;

    const kicker = kickerFor(slide.layout, opts.index);
    const kickerHtml = kicker ? `<span class="kicker">${kicker}</span>` : '';

    let body = '';
    switch (slide.layout) {
      case 'COVER': {
        const metaParts = slide.body ? slide.body.split(' • ').filter(Boolean) : [];
        const metaRow = metaParts.length
          ? `<div class="meta-row">${metaParts.map((m) => `<span class="meta-badge">${escapeHtml(m)}</span>`).join('')}</div>`
          : '';
        const hasImage = !!opts.heroImageUri;
        const visual = hasImage
          ? `<div class="visual-col"><div class="visual-frame hero-image-frame"><img src="${opts.heroImageUri}" alt="" /></div></div>`
          : `<div class="decor-shape"></div>`;
        body = `<div class="cover-grid${hasImage ? '' : ' no-image'}">
            <div class="content-col">
              <h1>${escapeHtml(slide.title)}</h1>
              ${slide.subtitle ? `<p class="subtitle">${escapeHtml(slide.subtitle)}</p>` : ''}
              ${metaRow}
            </div>
            ${visual}
          </div>`;
        break;
      }
      case 'VALUE_PROP': {
        const hasGallery = opts.galleryUris.length > 0;
        const visual = hasGallery
          ? `<div class="visual-col">${opts.galleryUris.map((u) => `<div class="visual-frame"><img src="${u}" alt="" /></div>`).join('')}</div>`
          : `<div class="decor-shape"></div>`;
        body = `<div class="content-grid${hasGallery ? '' : ' full'}">
            <div class="content-col">
              ${kickerHtml}
              <h2>${escapeHtml(slide.title)}</h2>
              <div class="accent-rule"></div>
              ${nl2p(slide.body)}
            </div>
            ${visual}
          </div>`;
        break;
      }
      case 'STAT_HIGHLIGHT': {
        const stats = (slide.stats ?? [])
          .map(
            (s) => `<div class="stat-card"><div class="stat-value">${escapeHtml(s.value)}</div><div class="stat-label">${escapeHtml(s.label)}</div></div>`,
          )
          .join('');
        body = `<div class="content-grid full"><div class="content-col">
            ${kickerHtml}<h2>${escapeHtml(slide.title)}</h2><div class="accent-rule"></div>
            ${nl2p(slide.body)}<div class="stats-grid">${stats}</div>
          </div><div class="decor-shape"></div></div>`;
        break;
      }
      case 'BULLET_LIST': {
        const items = (slide.bullets ?? []).map((b) => `<li>${escapeHtml(b)}</li>`).join('');
        body = `<div class="content-grid full"><div class="content-col">
            ${kickerHtml}<h2>${escapeHtml(slide.title)}</h2><div class="accent-rule"></div>
            <ul class="bullet-list">${items}</ul>
          </div><div class="decor-shape"></div></div>`;
        break;
      }
      case 'PAST_SPONSORS': {
        const sponsors = slide.resolvedPastSponsors ?? [];
        const cards = sponsors
          .map(
            (s) => `<div class="sponsor-card">
              ${s.logoUri ? `<img class="sponsor-logo" src="${s.logoUri}" alt="${escapeHtml(s.name)}" />` : `<span class="sponsor-name">${escapeHtml(s.name)}</span>`}
              ${s.logoUri ? `<span class="sponsor-name">${escapeHtml(s.name)}</span>` : ''}
              ${s.projectReference ? `<span class="sponsor-ref">${escapeHtml(s.projectReference)}</span>` : ''}
            </div>`,
          )
          .join('');
        body = `<div class="content-grid full"><div class="content-col">
            ${kickerHtml}<h2>${escapeHtml(slide.title)}</h2><div class="accent-rule"></div>
            ${sponsors.length ? `<div class="sponsors-grid">${cards}</div>` : nl2p(slide.body)}
          </div><div class="decor-shape"></div></div>`;
        break;
      }
      case 'PRICING_COMPARISON': {
        const tiers = (slide.pricingTiers ?? [])
          .map(
            (t) => `<div class="tier"><span class="tier-name">${escapeHtml(t.name)}</span><span class="tier-price">${escapeHtml(t.price.startsWith('₹') ? t.price : `₹${t.price}`)}</span></div>`,
          )
          .join('');
        const barter = slide.openToBarter ? `<span class="barter-badge">Open to Barter</span>` : '';
        const deadline = slide.sponsorshipDeadline ? `<p class="deadline-note">Sponsorship deadline: ${escapeHtml(slide.sponsorshipDeadline)}</p>` : '';
        body = `<div class="content-grid full"><div class="content-col">
            ${kickerHtml}<h2>${escapeHtml(slide.title)}</h2><div class="accent-rule"></div>
            <div class="tiers">${tiers}</div>${barter}${deadline}${nl2p(slide.body)}
          </div><div class="decor-shape"></div></div>`;
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
        body = `<div class="content-grid full"><div class="content-col">
            ${kickerHtml}<h2>${escapeHtml(slide.title)}</h2><div class="accent-rule"></div>
            ${nl2p(slide.body)}${contact}
          </div><div class="decor-shape"></div></div>`;
        break;
      }
    }

    const dots = Array.from({ length: opts.total }, (_, i) => `<span class="${i === opts.index ? 'active' : ''}"></span>`).join('');

    return `
      <section class="slide bg-${opts.bg}${opts.isLast ? ' slide-last' : ''}" style="background:${opts.bgColor}; --primary:${opts.primaryColor}; --accent:${opts.accentColor};">
        <div class="slide-header">
          <div class="slide-header-inner">${logoBlock}</div>
        </div>
        <div class="slide-body">${body}</div>
        <div class="slide-footer">
          <span class="powered-by"><img class="mini-logo" src="${MEETDAY_LOGO_DATA_URI}" alt="Meetday" /> Powered by Meetday.ai</span>
          <span class="progress-dots">${dots}</span>
          <span class="page-num">${opts.index + 1} / ${opts.total}</span>
        </div>
      </section>`;
  }
}

