import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { escapeHtml, renderHtmlToPdf } from '../orders/pdf-render.util';
import { MEETDAY_LOGO_DATA_URI } from '../../common/assets/meetday-logo.base64';

function money(value: unknown): string {
  return Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Simple payment receipt for a sponsorship deal — mirrors InvoicePdfService's rendering
// technique (self-contained HTML → PDF via Puppeteer) but with its own minimal template,
// since sponsorship deals don't share the ticket-order line-item/coupon shape.
@Injectable()
export class SponsorshipInvoicePdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
  ) {}

  async getDownloadUrl(dealId: string): Promise<string> {
    const deal = await this.prisma.sponsorshipDeal.findUnique({ where: { id: dealId }, select: { invoicePdfKey: true } });
    if (!deal) throw new NotFoundException('Deal not found');

    const key = deal.invoicePdfKey ?? (await this.persistForDeal(dealId)).key;
    return this.storageService.getPresignedDownloadUrl(key);
  }

  async persistForDeal(dealId: string): Promise<{ key: string; buffer: Buffer }> {
    const buffer = await this.generateForDeal(dealId);
    const key = `sponsorship-deals/${dealId}/invoice.pdf`;
    await this.storageService.uploadBuffer(key, buffer, 'application/pdf');
    await this.prisma.sponsorshipDeal.update({ where: { id: dealId }, data: { invoicePdfKey: key } });
    return { key, buffer };
  }

  async generateForDeal(dealId: string): Promise<Buffer> {
    const deal = await this.prisma.sponsorshipDeal.findUnique({
      where: { id: dealId },
      include: {
        sponsorshipInterest: {
          select: {
            sponsorshipProposal: {
              select: { name: true, hostProfile: { select: { displayName: true, communityProfile: { select: { name: true } } } } },
            },
            brandProfile: { select: { brandName: true } },
          },
        },
      },
    });
    if (!deal) throw new NotFoundException('Deal not found');
    if (deal.paymentStatus !== 'PAID') throw new NotFoundException('This deal has not been paid for yet');

    const communityName =
      deal.sponsorshipInterest.sponsorshipProposal.hostProfile.communityProfile?.name ??
      deal.sponsorshipInterest.sponsorshipProposal.hostProfile.displayName ??
      'Community';

    const paymentDate = (deal.paidAt ?? deal.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    const legalName = this.configService.get<string>('company.legalName') ?? 'Meetday Global Pvt. Ltd';
    const gstin = this.configService.get<string>('company.gstin') ?? '';
    const address = this.configService.get<string>('company.address') ?? '';

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><style>
  body { font-family: Arial, Helvetica, sans-serif; color: #111; padding: 32px; font-size: 13px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 16px; margin-bottom: 24px; }
  .logo { height: 36px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  td { padding: 6px 0; }
  .label { color: #666; }
  .value { text-align: right; font-weight: bold; }
  .total-row td { border-top: 2px solid #111; padding-top: 10px; font-size: 15px; }
</style></head>
<body>
  <div class="header">
    <div><img class="logo" src="${MEETDAY_LOGO_DATA_URI}" alt="Meetday" /></div>
    <div style="text-align:right">
      <h1>Payment Receipt</h1>
      <div>${escapeHtml(legalName)}</div>
      ${gstin ? `<div>GSTIN: ${escapeHtml(gstin)}</div>` : ''}
      ${address ? `<div>${escapeHtml(address)}</div>` : ''}
    </div>
  </div>

  <table>
    <tr><td class="label">Brand</td><td class="value">${escapeHtml(deal.sponsorshipInterest.brandProfile.brandName)}</td></tr>
    <tr><td class="label">Community</td><td class="value">${escapeHtml(communityName)}</td></tr>
    <tr><td class="label">Proposal / Project</td><td class="value">${escapeHtml(deal.sponsorshipInterest.sponsorshipProposal.name)}</td></tr>
    <tr><td class="label">Payment Date</td><td class="value">${escapeHtml(paymentDate)}</td></tr>
    <tr><td class="label">Payment Reference</td><td class="value">${escapeHtml(deal.razorpayPaymentId ?? '')}</td></tr>
  </table>

  <table>
    <tr><td class="label">Sponsorship Amount</td><td class="value">₹${money(deal.sponsorshipAmount)}</td></tr>
    <tr><td class="label">Platform Fee (5%)</td><td class="value">₹${money(deal.platformFeeAmount ?? 0)}</td></tr>
    <tr><td class="label">GST</td><td class="value">₹${money(deal.taxAmount ?? 0)}</td></tr>
    <tr class="total-row"><td>Total Paid</td><td class="value">₹${money(deal.totalAmount ?? deal.sponsorshipAmount)}</td></tr>
  </table>
</body>
</html>`;

    return renderHtmlToPdf(html, { width: '595px', height: '842px' });
  }
}
