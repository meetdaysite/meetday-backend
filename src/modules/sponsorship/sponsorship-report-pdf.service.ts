import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { escapeHtml, renderHtmlToPdf } from '../orders/pdf-render.util';
import { MEETDAY_LOGO_DATA_URI } from '../../common/assets/meetday-logo.base64';

function formatReportDate(val?: string | Date | null): string {
  if (!val) return '';
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? '' : val.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    }
  }
  return s;
}

// Report content is mutable (resubmit / approve / request revision), so unlike the payment
// invoice this is always regenerated fresh — never trusted from a cached PDF.
@Injectable()
export class SponsorshipReportPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
  ) {}

  async getDownloadUrl(interestId: string): Promise<string> {
    const buffer = await this.generateForReport(interestId);
    const key = `sponsorship-deal-reports/${interestId}/report-${Date.now()}.pdf`;
    await this.storageService.uploadBuffer(key, buffer, 'application/pdf');
    return this.storageService.getPresignedDownloadUrl(key);
  }

  async generateForReport(interestId: string): Promise<Buffer> {
    const interest = await this.prisma.sponsorshipInterest.findUnique({
      where: { id: interestId },
      include: {
        sponsorshipProposal: {
          select: {
            name: true,
            hostProfile: {
              select: {
                displayName: true,
                communityProfile: { select: { name: true } },
              },
            },
          },
        },
        campaign: {
          select: {
            name: true,
            brandProfile: { select: { brandName: true } },
          },
        },
        hostProfile: {
          select: {
            displayName: true,
            communityProfile: { select: { name: true } },
          },
        },
        brandProfile: { select: { brandName: true } },
      },
    });
    if (!interest) throw new NotFoundException('Chat thread not found');

    const deal = await this.prisma.sponsorshipDeal.findUnique({ where: { sponsorshipInterestId: interestId } });
    if (!deal) throw new NotFoundException('No deal found for this chat');

    const report = await this.prisma.sponsorshipDealReport.findUnique({ where: { sponsorshipDealId: deal.id } });
    if (!report) throw new NotFoundException('No report has been submitted for this deal yet');

    const communityName =
      interest.hostProfile?.communityProfile?.name ??
      interest.hostProfile?.displayName ??
      interest.sponsorshipProposal?.hostProfile?.communityProfile?.name ??
      interest.sponsorshipProposal?.hostProfile?.displayName ??
      'Community';

    const brandName =
      interest.campaign?.brandProfile?.brandName ??
      interest.brandProfile?.brandName ??
      'Brand';

    // The frontend embeds the actual field values as JSON inside `summary` rather than the
    // discrete columns — parse that first, falling back to the columns if it isn't JSON.
    let parsed: {
      projectName?: string;
      date?: string;
      venue?: string;
      time?: string;
      guestCount?: string;
      ageRange?: string;
      deliverables?: { text: string; checked: boolean }[];
      videoLinks?: string[];
      socialLinks?: string[];
      status?: string;
    } = {};
    if (report.summary) {
      try {
        parsed = JSON.parse(report.summary);
      } catch {
        /* fall back to columns below */
      }
    }

    const projectName =
      parsed.projectName ||
      report.projectName ||
      deal.projectName ||
      interest.campaign?.name ||
      interest.sponsorshipProposal?.name ||
      'Project';
    const rawEventDate = parsed.date || report.eventDate || deal.startDate || '';
    const formattedEventDate = formatReportDate(rawEventDate);
    const venue = parsed.venue || report.venue || deal.venue || '';
    const time = parsed.time || report.time || deal.time || '';
    const guestCount = parsed.guestCount || report.guestCount || '';
    const ageRange = parsed.ageRange || report.ageRange || '';
    const deliverables = parsed.deliverables?.length
      ? parsed.deliverables
      : (Array.isArray(report.deliverables) ? (report.deliverables as any[]) : []);
    const videoLinks = parsed.videoLinks?.length ? parsed.videoLinks : (report.videoLinks ?? []);
    const socialLinks = parsed.socialLinks?.length ? parsed.socialLinks : (report.socialLinks ?? []);
    const status = parsed.status || report.status || 'PENDING';

    const proofUrls: string[] = [];
    if (report.proofKeys && Array.isArray(report.proofKeys)) {
      for (const key of report.proofKeys) {
        if (!key || typeof key !== 'string') continue;
        try {
          const url = await this.storageService.getPresignedDownloadUrl(key);
          if (url) proofUrls.push(url);
        } catch {
          // ignore failed presign
        }
      }
    }

    const submittedDate = formatReportDate(report.submittedAt ?? new Date());
    const legalName = this.configService.get<string>('company.legalName') ?? 'Meetday Global Pvt. Ltd';

    const STATUS_INFO: Record<string, { label: string; bg: string; border: string; color: string }> = {
      APPROVED: { label: 'Approved / Closed', bg: '#ECFDF5', border: '#10B981', color: '#065F46' },
      PENDING: { label: 'Pending Approval', bg: '#FFFBEB', border: '#F59E0B', color: '#92400E' },
      REVISION_REQUESTED: { label: 'Revision Requested', bg: '#FEF2F2', border: '#EF4444', color: '#991B1B' },
    };
    const statusBadge = STATUS_INFO[status] ?? { label: status, bg: '#F3F4F6', border: '#D1D5DB', color: '#374151' };

    const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: #111827;
    background: #ffffff;
    padding: 36px 44px;
    font-size: 13px;
    line-height: 1.45;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2.5px solid #EE2C2C;
    padding-bottom: 16px;
    margin-bottom: 22px;
  }
  .logo { height: 40px; }
  .header-right { text-align: right; }
  .doc-title {
    font-size: 20px;
    font-weight: 900;
    color: #111827;
    letter-spacing: -0.3px;
    margin-bottom: 2px;
  }
  .legal-name { font-size: 11px; font-weight: 600; color: #6B7280; }
  .status-badge {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 9999px;
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    background: ${statusBadge.bg};
    border: 1.5px solid ${statusBadge.border};
    color: ${statusBadge.color};
    margin-top: 6px;
  }

  /* Key-Value Overview Grid */
  .overview-card {
    background: #F9FAFB;
    border: 1.5px solid #E5E7EB;
    border-radius: 12px;
    padding: 16px 20px;
    margin-bottom: 22px;
  }
  .grid-table { width: 100%; border-collapse: collapse; }
  .grid-table td { padding: 6px 12px 6px 0; vertical-align: top; }
  .label-cell {
    width: 130px;
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #6B7280;
  }
  .val-cell {
    font-size: 13px;
    font-weight: 700;
    color: #111827;
  }

  /* Sections */
  .section { margin-bottom: 20px; }
  .section-header {
    font-size: 13px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #111827;
    border-bottom: 1.5px solid #E5E7EB;
    padding-bottom: 6px;
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .section-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #EE2C2C;
    display: inline-block;
  }

  /* Deliverables Checklist */
  .checklist {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .checklist-item {
    display: flex;
    align-items: center;
    gap: 10px;
    background: #FFFFFF;
    border: 1px solid #E5E7EB;
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 12.5px;
    font-weight: 600;
  }
  .check-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 5px;
    font-size: 11px;
    font-weight: 900;
    flex-shrink: 0;
  }
  .check-icon.checked {
    background: #10B981;
    color: #ffffff;
  }
  .check-icon.unchecked {
    background: #F3F4F6;
    border: 1.5px solid #D1D5DB;
    color: transparent;
  }

  /* Links */
  .link-list {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .link-pill {
    display: block;
    background: #F9FAFB;
    border: 1px solid #E5E7EB;
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 11.5px;
    font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    color: #2563EB;
    word-break: break-all;
  }

  /* Notes */
  .note-box {
    background: #FFFBEB;
    border-left: 3.5px solid #F59E0B;
    border-radius: 0 8px 8px 0;
    padding: 10px 14px;
    font-size: 12px;
    color: #78350F;
    line-height: 1.5;
  }
  .revision-box {
    background: #FEF2F2;
    border-left: 3.5px solid #EF4444;
    border-radius: 0 8px 8px 0;
    padding: 10px 14px;
    font-size: 12px;
    color: #7F1D1D;
    line-height: 1.5;
  }

  /* Proof grid */
  .proof-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 6px;
  }
  .proof-item {
    width: 145px;
    height: 105px;
    border-radius: 8px;
    border: 1.5px solid #E5E7EB;
    object-fit: cover;
    background: #F3F4F6;
  }

  /* Footer */
  .footer {
    margin-top: 32px;
    border-top: 1px solid #E5E7EB;
    padding-top: 12px;
    display: flex;
    justify-content: space-between;
    font-size: 10px;
    color: #9CA3AF;
    font-weight: 600;
  }
</style>
</head>
<body>
  <div class="header">
    <div>
      <img class="logo" src="${MEETDAY_LOGO_DATA_URI}" alt="Meetday" />
    </div>
    <div class="header-right">
      <div class="doc-title">DELIVERABLES REPORT</div>
      <div class="legal-name">${escapeHtml(legalName)}</div>
      <div><span class="status-badge">${escapeHtml(statusBadge.label)}</span></div>
    </div>
  </div>

  <div class="overview-card">
    <table class="grid-table">
      <tr>
        <td class="label-cell">Community</td>
        <td class="val-cell">${escapeHtml(communityName)}</td>
        <td class="label-cell">Event Date</td>
        <td class="val-cell">${escapeHtml(formattedEventDate || '—')}</td>
      </tr>
      <tr>
        <td class="label-cell">Brand</td>
        <td class="val-cell">${escapeHtml(brandName)}</td>
        <td class="label-cell">Venue</td>
        <td class="val-cell">${escapeHtml(venue || '—')}</td>
      </tr>
      <tr>
        <td class="label-cell">Project</td>
        <td class="val-cell">${escapeHtml(projectName)}</td>
        <td class="label-cell">Time</td>
        <td class="val-cell">${escapeHtml(time || '—')}</td>
      </tr>
      <tr>
        <td class="label-cell">Submitted On</td>
        <td class="val-cell">${escapeHtml(submittedDate || '—')}</td>
        <td class="label-cell">Guest Count</td>
        <td class="val-cell">${escapeHtml(guestCount || '—')}</td>
      </tr>
      ${ageRange ? `
      <tr>
        <td class="label-cell">Age Range</td>
        <td class="val-cell" colspan="3">${escapeHtml(ageRange)}</td>
      </tr>
      ` : ''}
    </table>
  </div>

  ${deliverables.length ? `
  <div class="section">
    <div class="section-header"><span class="section-dot"></span> Deliverables Checklist</div>
    <div class="checklist">
      ${deliverables.map((d) => `
        <div class="checklist-item">
          <span class="check-icon ${d.checked ? 'checked' : 'unchecked'}">${d.checked ? '✓' : ''}</span>
          <span>${escapeHtml(d.text)}</span>
        </div>
      `).join('')}
    </div>
  </div>
  ` : ''}

  ${videoLinks.length ? `
  <div class="section">
    <div class="section-header"><span class="section-dot"></span> Video Links</div>
    <div class="link-list">
      ${videoLinks.map((l) => `<div class="link-pill">${escapeHtml(l)}</div>`).join('')}
    </div>
  </div>
  ` : ''}

  ${socialLinks.length ? `
  <div class="section">
    <div class="section-header"><span class="section-dot"></span> Social Media Links</div>
    <div class="link-list">
      ${socialLinks.map((l) => `<div class="link-pill">${escapeHtml(l)}</div>`).join('')}
    </div>
  </div>
  ` : ''}

  ${report.notes ? `
  <div class="section">
    <div class="section-header"><span class="section-dot"></span> Host Notes</div>
    <div class="note-box">${escapeHtml(report.notes)}</div>
  </div>
  ` : ''}

  ${report.revisionNote ? `
  <div class="section">
    <div class="section-header"><span class="section-dot"></span> Revision Requested</div>
    <div class="revision-box">${escapeHtml(report.revisionNote)}</div>
  </div>
  ` : ''}

  ${proofUrls.length ? `
  <div class="section">
    <div class="section-header"><span class="section-dot"></span> Proof Photos (${proofUrls.length})</div>
    <div class="proof-grid">
      ${proofUrls.map((u) => `<img class="proof-item" src="${u}" />`).join('')}
    </div>
  </div>
  ` : ''}

  <div class="footer">
    <div>Meetday Global • Official Verification Document</div>
    <div>Generated: ${escapeHtml(new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }))}</div>
  </div>
</body>
</html>`;

    return renderHtmlToPdf(html, { width: '794px', height: '1123px' });
  }
}
