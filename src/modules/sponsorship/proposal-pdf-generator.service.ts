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
          mediaKitUrl: index === 2 ? dto.mediaKitUrl : undefined,
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
  .slide-header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 16px; margin-bottom: 36px;
    border-bottom: ${minimalist ? '1px solid currentColor' : '3px solid currentColor'}; opacity: 1; }
  .slide-header-inner { display: flex; align-items: center; gap: 14px; }
  .logo-chip { background: rgba(255,255,255,0.85); border-radius: 12px; padding: 6px 10px; display: inline-flex; align-items: center; }
  .bg-dark .logo-chip { background: rgba(255,255,255,0.12); }
  .logo { height: 34px; max-width: 160px; object-fit: contain; }
  .logo-large { height: 90px; max-width: 320px; }
  .slide-label { font-size: 13px; font-weight: 900; text-transform: uppercase; letter-spacing: ${minimalist ? '0.16em' : '0.08em'}; opacity: 0.6; }
  .slide-body { flex: 1; display: flex; flex-direction: column; justify-content: center; }
  .slide-body h1 { font-family: ${fonts.heading}; font-size: 52px; font-weight: ${minimalist ? 300 : 900}; letter-spacing: -0.01em; margin: 0 0 12px; }
  .slide-body h2 { font-family: ${fonts.heading}; font-size: 34px; font-weight: ${minimalist ? 300 : 900}; letter-spacing: -0.01em; margin: 0 0 24px; color: var(--primary); }
  .slide-body .subtitle { font-size: 20px; font-weight: 600; opacity: 0.65; margin: 0; }
  .slide-body p { font-size: 22px; line-height: 1.6; margin: 0 0 16px; max-width: 980px; opacity: 0.9; }
  .hero-image { max-height: 260px; max-width: 100%; object-fit: contain; border-radius: 16px; margin-top: 20px; }
  .stats-grid { display: flex; flex-wrap: wrap; gap: 20px; margin-top: 16px; }
  .stat-card { border: 2px solid var(--primary); border-radius: 18px; padding: 22px 28px; min-width: 180px; }
  .stat-value { font-size: 40px; font-weight: 900; color: var(--primary); }
  .stat-label { font-size: 14px; font-weight: 700; opacity: 0.6; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 4px; }
  .bullet-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 14px; }
  .bullet-list li { font-size: 22px; padding-left: 32px; position: relative; opacity: 0.9; }
  .bullet-list li::before { content: ''; position: absolute; left: 0; top: 10px; width: 12px; height: 12px; border-radius: 50%; background: var(--primary); }
  .tiers { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 12px; }
  .tier { display: flex; align-items: center; gap: 10px; border: 2px solid var(--primary); border-radius: 16px; padding: 14px 22px; }
  .tier-name { font-weight: 700; font-size: 20px; }
  .tier-price { font-weight: 900; font-size: 20px; color: var(--primary); }
  .contact-block p { margin: 0 0 6px; }
  .contact-block .contact-label { opacity: 0.6; font-weight: 600; }
  .sponsors-grid { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 16px; }
  .sponsor-card { display: flex; flex-direction: column; align-items: center; gap: 8px; border: 2px solid var(--primary); border-radius: 16px; padding: 18px 24px; min-width: 160px; }
  .sponsor-logo { height: 40px; max-width: 120px; object-fit: contain; }
  .sponsor-name { font-weight: 700; font-size: 16px; }
  .sponsor-ref { font-size: 12px; opacity: 0.6; }
  .barter-badge { display: inline-block; margin-top: 12px; padding: 6px 14px; border-radius: 999px; font-size: 13px; font-weight: 700; background: var(--primary); color: #fff; }
  .deadline-note { font-size: 15px; opacity: 0.7; margin-top: 10px; }
  .media-gallery { display: flex; gap: 14px; margin-top: 20px; }
  .media-gallery img { width: 160px; height: 160px; object-fit: contain; border-radius: 10px; border: 2px solid currentColor; opacity: 0.95; background: rgba(127,127,127,0.08); }
  .media-kit-link { font-size: 13px; opacity: 0.6; margin-top: 10px; }
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
      mediaKitUrl?: string;
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

    const gallery = opts.galleryUris.length
      ? `<div class="media-gallery">${opts.galleryUris.map((u) => `<img src="${u}" alt="" />`).join('')}</div>`
      : '';
    const mediaKitLink = opts.mediaKitUrl
      ? `<p class="media-kit-link">Brand Media Kit: ${escapeHtml(opts.mediaKitUrl)}</p>`
      : '';

    let body = '';
    switch (slide.layout) {
      case 'COVER':
        body = `<h1>${escapeHtml(slide.title)}</h1>${slide.subtitle ? `<p class="subtitle">${escapeHtml(slide.subtitle)}</p>` : ''}${slide.body ? `<p class="subtitle">${escapeHtml(slide.body)}</p>` : ''}${opts.heroImageUri ? `<img class="hero-image" src="${opts.heroImageUri}" alt="" />` : ''}`;
        break;
      case 'VALUE_PROP':
        body = `<h2>${escapeHtml(slide.title)}</h2>${nl2p(slide.body)}${gallery}${mediaKitLink}`;
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
        body = `<h2>${escapeHtml(slide.title)}</h2>${sponsors.length ? `<div class="sponsors-grid">${cards}</div>` : nl2p(slide.body)}`;
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
        body = `<h2>${escapeHtml(slide.title)}</h2><div class="tiers">${tiers}</div>${barter}${deadline}${nl2p(slide.body)}`;
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
      <section class="slide bg-${opts.bg}${opts.isLast ? ' slide-last' : ''}" style="background:${opts.bgColor}; --primary:${opts.primaryColor}; --accent:${opts.accentColor};">
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

