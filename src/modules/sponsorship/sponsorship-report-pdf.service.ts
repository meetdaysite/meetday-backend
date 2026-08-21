import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { escapeHtml, renderHtmlToPdf } from '../orders/pdf-render.util';
import { MEETDAY_LOGO_DATA_URI } from '../../common/assets/meetday-logo.base64';

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
      select: {
        sponsorshipProposal: {
          select: { name: true, hostProfile: { select: { displayName: true, communityProfile: { select: { name: true } } } } },
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
      interest.sponsorshipProposal.hostProfile.communityProfile?.name ?? interest.sponsorshipProposal.hostProfile.displayName ?? 'Community';

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
    try {
      parsed = JSON.parse(report.summary);
    } catch {
      /* fall back to columns below */
    }

    const projectName = parsed.projectName || report.projectName || deal.projectName;
    const eventDate = parsed.date || report.eventDate || '';
    const venue = parsed.venue || report.venue || '';
    const time = parsed.time || report.time || '';
    const guestCount = parsed.guestCount || report.guestCount || '';
    const ageRange = parsed.ageRange || report.ageRange || '';
    const deliverables = parsed.deliverables?.length ? parsed.deliverables : [];
    const videoLinks = parsed.videoLinks?.length ? parsed.videoLinks : report.videoLinks;
    const socialLinks = parsed.socialLinks?.length ? parsed.socialLinks : report.socialLinks;
    const status = parsed.status || report.status;

    const proofUrls = await Promise.all(report.proofKeys.map((key) => this.storageService.getPresignedDownloadUrl(key)));

    const submittedDate = report.submittedAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    const legalName = this.configService.get<string>('company.legalName') ?? 'Meetday Global Pvt. Ltd';

    const STATUS_LABEL: Record<string, string> = { PENDING: 'Pending Approval', APPROVED: 'Approved', REVISION_REQUESTED: 'Revision Requested' };

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><style>
  body { font-family: Arial, Helvetica, sans-serif; color: #111; padding: 32px; font-size: 13px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 16px; margin-bottom: 24px; }
  .logo { height: 36px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  td { padding: 5px 0; vertical-align: top; }
  .label { color: #666; width: 160px; }
  .value { font-weight: bold; }
  .section-title { font-size: 13px; font-weight: bold; margin-top: 18px; margin-bottom: 6px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  .checklist-item { padding: 2px 0; }
  .proof-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .proof-grid img { width: 140px; height: 100px; object-fit: cover; border: 1px solid #ddd; border-radius: 4px; }
</style></head>
<body>
  <div class="header">
    <div><img class="logo" src="${MEETDAY_LOGO_DATA_URI}" alt="Meetday" /></div>
    <div style="text-align:right">
      <h1>Deliverables Report</h1>
      <div>${escapeHtml(legalName)}</div>
    </div>
  </div>

  <table>
    <tr><td class="label">Community</td><td class="value">${escapeHtml(communityName)}</td></tr>
    <tr><td class="label">Brand</td><td class="value">${escapeHtml(interest.brandProfile.brandName)}</td></tr>
    <tr><td class="label">Project</td><td class="value">${escapeHtml(projectName)}</td></tr>
    ${eventDate ? `<tr><td class="label">Event Date</td><td class="value">${escapeHtml(eventDate)}</td></tr>` : ''}
    ${venue ? `<tr><td class="label">Venue</td><td class="value">${escapeHtml(venue)}</td></tr>` : ''}
    ${time ? `<tr><td class="label">Time</td><td class="value">${escapeHtml(time)}</td></tr>` : ''}
    ${guestCount ? `<tr><td class="label">Guest Count</td><td class="value">${escapeHtml(guestCount)}</td></tr>` : ''}
    ${ageRange ? `<tr><td class="label">Age Range</td><td class="value">${escapeHtml(ageRange)}</td></tr>` : ''}
    <tr><td class="label">Status</td><td class="value">${escapeHtml(STATUS_LABEL[status] ?? status)}</td></tr>
    <tr><td class="label">Submitted On</td><td class="value">${escapeHtml(submittedDate)}</td></tr>
  </table>

  ${deliverables.length ? `
  <div class="section-title">Deliverables</div>
  ${deliverables.map((d) => `<div class="checklist-item">${d.checked ? '\u2611' : '\u2610'} ${escapeHtml(d.text)}</div>`).join('')}
  ` : ''}

  ${videoLinks.length ? `
  <div class="section-title">Video Links</div>
  ${videoLinks.map((l) => `<div>${escapeHtml(l)}</div>`).join('')}
  ` : ''}

  ${socialLinks.length ? `
  <div class="section-title">Social Links</div>
  ${socialLinks.map((l) => `<div>${escapeHtml(l)}</div>`).join('')}
  ` : ''}

  ${report.notes ? `
  <div class="section-title">Notes</div>
  <div>${escapeHtml(report.notes)}</div>
  ` : ''}

  ${report.revisionNote ? `
  <div class="section-title">Revision Requested</div>
  <div>${escapeHtml(report.revisionNote)}</div>
  ` : ''}

  ${proofUrls.length ? `
  <div class="section-title">Proof Images</div>
  <div class="proof-grid">${proofUrls.map((u) => `<img src="${u}" />`).join('')}</div>
  ` : ''}
</body>
</html>`;

    return renderHtmlToPdf(html, { width: '595px', height: '842px' });
  }
}
