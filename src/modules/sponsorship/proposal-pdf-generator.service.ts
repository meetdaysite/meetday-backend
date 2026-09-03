import { Injectable } from '@nestjs/common';
import { escapeHtml, renderHtmlToPdf } from '../orders/pdf-render.util';
import { MEETDAY_LOGO_DATA_URI } from '../../common/assets/meetday-logo.base64';
import { GenerateProposalPdfDto } from './dto/generate-proposal-pdf.dto';
import { GenerateProposalDeckPdfDto } from './dto/generate-proposal-deck-pdf.dto';

// Standalone "quick pitch" PDF generator for hosts — unlike SponsorshipReportPdfService/
// SponsorshipInvoicePdfService, this has NO backing DB record: the form data IS the document,
// rendered straight to a downloadable buffer (no persistence, no storage upload).
// Visual language deliberately mirrors the in-app shared-proposal view
// (frontend/src/app/brand/proposal/[id]/page.tsx) — bold black borders, hard drop-shadows,
// and #EE2C2C pill badges for key facts — so a downloaded PDF looks like it came from the
// same product as the on-platform proposal pages brands/communities already see.
@Injectable()
export class ProposalPdfGeneratorService {
  async generate(dto: GenerateProposalPdfDto): Promise<Buffer> {
    const nl2p = (text: string) =>
      escapeHtml(text)
        .split(/\n+/)
        .map((line) => `<p>${line}</p>`)
        .join('');

    const pill = (label: string) =>
      `<span class="pill">${escapeHtml(label)}</span>`;

    const pricingTiers = (dto.pricingTiers ?? [])
      .map(
        (t) => `
        <div class="tier">
          <span class="tier-name">${escapeHtml(t.name)}</span>
          <span class="tier-price">${escapeHtml(t.price.startsWith('₹') ? t.price : `₹${t.price}`)}</span>
        </div>`,
      )
      .join('');

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; padding: 36px; font-size: 13px; line-height: 1.6; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #000; padding-bottom: 18px; margin-bottom: 24px; gap: 20px; }
  .logo { height: 32px; flex-shrink: 0; }
  h1 { font-size: 22px; font-weight: 900; margin: 0 0 2px; letter-spacing: -0.01em; text-align: right; }
  .subtitle { font-size: 12px; font-weight: 600; color: #666; }
  .card {
    background: #fff; border: 2px solid #000; border-radius: 20px; padding: 18px 20px;
    box-shadow: 3px 3px 0px 0px rgba(0,0,0,1); margin-bottom: 18px;
  }
  .card h4 { font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.06em; color: #111; margin: 0 0 10px; }
  p { margin: 0 0 6px; color: #333; }
  .pill {
    display: inline-flex; align-items: center; padding: 5px 12px; border-radius: 999px;
    font-size: 10px; font-weight: 900; background: #EE2C2C; color: #fff; border: 1.5px solid #000;
    box-shadow: 1.5px 1.5px 0px 0px rgba(0,0,0,1); margin-right: 6px;
  }
  .facts { display: flex; flex-wrap: wrap; gap: 10px; }
  .tiers { display: flex; flex-wrap: wrap; gap: 10px; }
  .tier {
    display: flex; align-items: center; gap: 8px; border: 1.5px solid #ddd; border-radius: 12px;
    padding: 8px 14px; background: #FAFAFA;
  }
  .tier-name { font-weight: 600; color: #333; }
  .tier-price { font-weight: 900; color: #EE2C2C; }
  .contact span { color: #666; font-weight: 600; }
</style></head>
<body>
  <div class="header">
    <div><img class="logo" src="${MEETDAY_LOGO_DATA_URI}" alt="Meetday" /></div>
    <div style="text-align:right">
      <h1>${escapeHtml(dto.eventTitle)}</h1>
      <div class="subtitle">Sponsorship Proposal for ${escapeHtml(dto.sponsorName)}</div>
    </div>
  </div>

  <div class="card">
    <h4>Overview</h4>
    <div class="facts">
      ${pill(dto.sponsorName)}
    </div>
  </div>

  <div class="card">
    <h4>Deliverables</h4>
    ${nl2p(dto.deliverables)}
  </div>

  <div class="card">
    <h4>Timeline</h4>
    ${nl2p(dto.timeline)}
  </div>

  ${pricingTiers ? `<div class="card"><h4>Sponsor Pricing Tiers</h4><div class="tiers">${pricingTiers}</div></div>` : ''}

  <div class="card">
    <h4>Terms</h4>
    ${nl2p(dto.terms)}
  </div>

  <div class="card contact">
    <h4>Contact</h4>
    <p>${escapeHtml(dto.contactName)}</p>
    <p><span>Email:</span> ${escapeHtml(dto.contactEmail)}</p>
    ${dto.contactPhone ? `<p><span>Phone:</span> ${escapeHtml(dto.contactPhone)}</p>` : ''}
  </div>
</body>
</html>`;

    return renderHtmlToPdf(html, { width: '595px', height: '842px' });
  }

  // Presentation-style deck (6 slides, one per PDF page) — design/layout is fixed, only the
  // slide COPY (already AI-expanded + user-edited by this point) varies. Landscape 16:9-ish
  // canvas so it reads like an actual pitch deck, not a scaled-down document.
  async generateDeck(dto: GenerateProposalDeckPdfDto): Promise<Buffer> {
    const nl2p = (text: string) =>
      escapeHtml(text)
        .split(/\n+/)
        .map((line) => `<p>${line}</p>`)
        .join('');

    const pricingTiers = (dto.pricingTiers ?? [])
      .map(
        (t) => `
        <div class="tier">
          <span class="tier-name">${escapeHtml(t.name)}</span>
          <span class="tier-price">${escapeHtml(t.price.startsWith('₹') ? t.price : `₹${t.price}`)}</span>
        </div>`,
      )
      .join('');

    const slide = (label: string, body: string, opts?: { last?: boolean }) => `
      <section class="slide${opts?.last ? ' slide-last' : ''}">
        <div class="slide-header">
          <img class="logo" src="${MEETDAY_LOGO_DATA_URI}" alt="Meetday" />
          <span class="slide-label">${escapeHtml(label)}</span>
        </div>
        <div class="slide-body">${body}</div>
      </section>`;

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; }
  .slide {
    width: 1280px; height: 720px; padding: 56px 72px; display: flex; flex-direction: column;
    break-after: page; page-break-after: always; position: relative; background: #fff;
  }
  .slide-last { break-after: auto; page-break-after: auto; }
  .slide-header { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid #000; padding-bottom: 16px; margin-bottom: 36px; }
  .logo { height: 34px; }
  .slide-label { font-size: 13px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.08em; color: #666; }
  .slide-body { flex: 1; display: flex; flex-direction: column; justify-content: center; }
  .slide-body h1 { font-size: 52px; font-weight: 900; letter-spacing: -0.01em; margin: 0 0 12px; }
  .slide-body h2 { font-size: 34px; font-weight: 900; letter-spacing: -0.01em; margin: 0 0 24px; }
  .slide-body .subtitle { font-size: 20px; font-weight: 600; color: #666; margin: 0; }
  .slide-body p { font-size: 22px; line-height: 1.6; color: #222; margin: 0 0 16px; max-width: 980px; }
  .facts { display: flex; gap: 12px; margin-top: 24px; }
  .pill {
    display: inline-flex; align-items: center; padding: 8px 18px; border-radius: 999px;
    font-size: 14px; font-weight: 900; background: #EE2C2C; color: #fff; border: 2px solid #000;
    box-shadow: 2px 2px 0px 0px rgba(0,0,0,1);
  }
  .tiers { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 12px; }
  .tier {
    display: flex; align-items: center; gap: 10px; border: 2px solid #000; border-radius: 16px;
    padding: 14px 22px; background: #FAFAFA; box-shadow: 2px 2px 0px 0px rgba(0,0,0,1);
  }
  .tier-name { font-weight: 700; font-size: 20px; color: #222; }
  .tier-price { font-weight: 900; font-size: 20px; color: #EE2C2C; }
  .contact-block p { margin: 0 0 6px; }
  .contact-block span { color: #666; font-weight: 600; }
</style></head>
<body>
  ${slide(
    'Sponsorship Proposal',
    `<h1>${escapeHtml(dto.eventTitle)}</h1><p class="subtitle">Prepared for ${escapeHtml(dto.sponsorName)}</p>`,
  )}
  ${slide('Value Proposition', `<h2>Why Sponsor This</h2>${nl2p(dto.valueProposition)}`)}
  ${slide('Campaign Overview', `<h2>About The Campaign</h2>${nl2p(dto.campaignOverview)}`)}
  ${slide('Audience Reach', `<h2>Who You'll Reach</h2>${nl2p(dto.audienceReach)}`)}
  ${slide(
    'Deliverables & Timeline',
    `<h2>What's Included</h2>${nl2p(dto.deliverablesExpanded)}<h2 style="margin-top:24px">Timeline</h2>${nl2p(dto.timelineExpanded)}`,
  )}
  ${slide(
    'Pricing & Contact',
    `<h2>Sponsor Pricing</h2>${pricingTiers ? `<div class="tiers">${pricingTiers}</div>` : ''}
     <div class="contact-block" style="margin-top:32px">
       <p style="font-size:22px;font-weight:700">${escapeHtml(dto.contactName)}</p>
       <p><span>Email:</span> ${escapeHtml(dto.contactEmail)}</p>
       ${dto.contactPhone ? `<p><span>Phone:</span> ${escapeHtml(dto.contactPhone)}</p>` : ''}
     </div>
     <div style="margin-top:24px">${nl2p(dto.terms)}</div>`,
    { last: true },
  )}
</body>
</html>`;

    return renderHtmlToPdf(html, { width: '1280px', height: '720px' });
  }
}
