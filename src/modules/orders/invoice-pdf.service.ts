import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { escapeHtml, renderHtmlToPdf } from './pdf-render.util';
import { MEETDAY_LOGO_DATA_URI } from '../../common/assets/meetday-logo.base64';

const DEFAULT_GST_RATE = 0.18;

function money(value: unknown): string {
  return Number(value).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

@Injectable()
export class InvoicePdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
  ) {}

  // Generates the tax-invoice PDF and persists it to GCS, recording the object
  // key on the order. Returns the buffer too so the confirmation email reuses the
  // same render instead of generating it twice. Mirrors TicketPdfService.
  async persistForOrder(orderId: string): Promise<{ key: string; buffer: Buffer }> {
    const buffer = await this.generateForOrder(orderId);
    const key = `orders/${orderId}/invoice.pdf`;
    await this.storageService.uploadBuffer(key, buffer, 'application/pdf');
    await this.prisma.order.update({
      where: { id: orderId },
      data: { invoicePdfKey: key },
    });
    return { key, buffer };
  }

  // Returns a short-lived presigned URL for the order's invoice PDF, lazily
  // generating and persisting it on first access if not yet materialized.
  async getDownloadUrl(orderId: string): Promise<string> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { invoicePdfKey: true },
    });
    if (!order) throw new Error(`Order ${orderId} not found`);

    const key = order.invoicePdfKey ?? (await this.persistForOrder(orderId)).key;
    return this.storageService.getPresignedDownloadUrl(key);
  }

  async generateForOrder(orderId: string): Promise<Buffer> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
        event: { select: { title: true, eventDate: true } },
        coupon: { select: { code: true } },
        items: {
          include: {
            ticket: { select: { name: true } },
            attendees: { where: { isLead: true }, select: { fullName: true }, take: 1 },
          },
        },
      },
    });

    if (!order) throw new Error(`Order ${orderId} not found`);

    // GST rate is stored in platform config; used only to label the tax line.
    const gstConfig = await this.prisma.platformConfig.findUnique({ where: { key: 'gst_rate' } });
    const gstRate = gstConfig ? parseFloat(gstConfig.value) : DEFAULT_GST_RATE;

    const leadName =
      order.items.flatMap((i) => i.attendees).find((a) => a.fullName)?.fullName ??
      `${order.user.firstName} ${order.user.lastName}`.trim();

    const eventDate = order.event.eventDate
      ? new Date(order.event.eventDate).toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : '';
    const invoiceDate = (order.confirmedAt ?? order.createdAt).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    const html = buildInvoiceHtml({
      company: {
        legalName: this.configService.get<string>('company.legalName') ?? 'Meetday Global Pvt. Ltd',
        gstin: this.configService.get<string>('company.gstin') ?? '',
        address: this.configService.get<string>('company.address') ?? 'INNOV8 UCP, 9TH FLOOR, TOWER D,UNITED CYBER PARK, Gurgaon, Sadar Bazar, Haryana, India 122001',
        supportEmail: this.configService.get<string>('company.supportEmail') ?? '',
      },
      invoiceNo: order.bookingId,
      invoiceDate,
      paymentRef: order.razorpayPaymentId ?? '',
      buyerName: leadName,
      buyerEmail: order.user.email ?? '',
      eventTitle: order.event.title,
      eventDate,
      lineItems: order.items.map((item) => ({
        name: item.ticket.name,
        quantity: item.quantity,
        unitPrice: money(item.unitPrice),
        amount: money(Number(item.unitPrice) * item.quantity),
      })),
      subtotal: money(order.subtotal),
      discountAmount: money(order.discountAmount),
      hasDiscount: Number(order.discountAmount) > 0,
      couponCode: order.coupon?.code ?? '',
      platformFee: money(order.platformFee),
      taxableValue: money(Number(order.netSubtotal) + Number(order.platformFee)),
      gstLabel: `GST @ ${(gstRate * 100).toFixed(gstRate * 100 % 1 === 0 ? 0 : 2)}%`,
      taxAmount: money(order.taxAmount),
      totalAmount: money(order.totalAmount),
    });

    return renderHtmlToPdf(html, { width: '595px', height: '842px' });
  }
}

interface InvoiceData {
  company: { legalName: string; gstin: string; address: string; supportEmail: string };
  invoiceNo: string;
  invoiceDate: string;
  paymentRef: string;
  buyerName: string;
  buyerEmail: string;
  eventTitle: string;
  eventDate: string;
  lineItems: Array<{ name: string; quantity: number; unitPrice: string; amount: string }>;
  subtotal: string;
  discountAmount: string;
  hasDiscount: boolean;
  couponCode: string;
  platformFee: string;
  taxableValue: string;
  gstLabel: string;
  taxAmount: string;
  totalAmount: string;
}

function buildInvoiceHtml(d: InvoiceData): string {
  const rows = d.lineItems
    .map(
      (li, i) => `
      <tr>
        <td class="c-idx">${i + 1}</td>
        <td>${escapeHtml(li.name)}</td>
        <td class="c-num">${li.quantity}</td>
        <td class="c-num">&#8377;${li.unitPrice}</td>
        <td class="c-num">&#8377;${li.amount}</td>
      </tr>`,
    )
    .join('');

  const discountRow = d.hasDiscount
    ? `<div class="tr"><span>Discount${d.couponCode ? ` (${escapeHtml(d.couponCode)})` : ''}</span><span>&#8722;&#8377;${d.discountAmount}</span></div>`
    : '';

  const gstinLine = d.company.gstin
    ? `<div class="co-line">GSTIN: ${escapeHtml(d.company.gstin)}</div>`
    : '';
  const addressLine = d.company.address
    ? `<div class="co-line">${escapeHtml(d.company.address)}</div>`
    : '';
  const supportLine = d.company.supportEmail
    ? `<div class="co-line">${escapeHtml(d.company.supportEmail)}</div>`
    : '';
  const paymentRefLine = d.paymentRef
    ? `<div class="meta-row"><span>Payment Ref</span><b>${escapeHtml(d.paymentRef)}</b></div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Helvetica Neue',Arial,sans-serif;color:#1a1a2e;background:#fff;padding:40px 44px;font-size:12px}
  .brand-logo{width:48px;height:48px;background:center/contain no-repeat url('${MEETDAY_LOGO_DATA_URI}')}
  .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #c0392b;padding-bottom:16px}
  .co-name{font-size:18px;font-weight:800;margin:8px 0 4px}
  .co-line{font-size:10.5px;color:#666;line-height:1.5}
  .doc-title{font-size:22px;font-weight:800;color:#c0392b;letter-spacing:1px;text-align:right}
  .meta{margin-top:8px;text-align:right;font-size:10.5px;color:#666}
  .meta-row{display:flex;justify-content:flex-end;gap:8px;margin-top:2px}
  .meta-row b{color:#1a1a2e;font-family:'Courier New',monospace}
  .parties{display:flex;justify-content:space-between;margin-top:22px;gap:24px}
  .party{flex:1}
  .party .label{font-size:9.5px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#999;margin-bottom:5px}
  .party .val{font-size:12.5px;font-weight:700}
  .party .sub{font-size:10.5px;color:#666;margin-top:2px}
  table{width:100%;border-collapse:collapse;margin-top:24px}
  thead th{background:#1a1a2e;color:#fff;font-size:10px;letter-spacing:.5px;text-transform:uppercase;text-align:left;padding:9px 10px}
  th.c-num,td.c-num{text-align:right}
  th.c-idx,td.c-idx{text-align:center;width:32px}
  tbody td{padding:9px 10px;border-bottom:1px solid #eee;font-size:11.5px}
  .totals{margin-top:16px;margin-left:auto;width:280px}
  .tr{display:flex;justify-content:space-between;padding:5px 0;font-size:11.5px;color:#444}
  .tr.grand{border-top:2px solid #1a1a2e;margin-top:6px;padding-top:10px;font-size:15px;font-weight:800;color:#1a1a2e}
  .tr.grand span:last-child{color:#c0392b}
  .foot{margin-top:40px;border-top:1px solid #eee;padding-top:14px;font-size:10px;color:#999;line-height:1.6}
</style>
</head>
<body>
  <div class="head">
    <div>
      <div class="brand-logo"></div>
      <div class="co-name">${escapeHtml(d.company.legalName)}</div>
      ${gstinLine}
      ${addressLine}
      ${supportLine}
    </div>
    <div>
      <div class="doc-title">TAX INVOICE</div>
      <div class="meta">
        <div class="meta-row"><span>Invoice No</span><b>${escapeHtml(d.invoiceNo)}</b></div>
        <div class="meta-row"><span>Date</span><b>${escapeHtml(d.invoiceDate)}</b></div>
        ${paymentRefLine}
      </div>
    </div>
  </div>

  <div class="parties">
    <div class="party">
      <div class="label">Billed To</div>
      <div class="val">${escapeHtml(d.buyerName)}</div>
      ${d.buyerEmail ? `<div class="sub">${escapeHtml(d.buyerEmail)}</div>` : ''}
    </div>
    <div class="party">
      <div class="label">Event</div>
      <div class="val">${escapeHtml(d.eventTitle)}</div>
      ${d.eventDate ? `<div class="sub">${escapeHtml(d.eventDate)}</div>` : ''}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th class="c-idx">#</th>
        <th>Description</th>
        <th class="c-num">Qty</th>
        <th class="c-num">Unit Price</th>
        <th class="c-num">Amount</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="totals">
    <div class="tr"><span>Subtotal</span><span>&#8377;${d.subtotal}</span></div>
    ${discountRow}
    <div class="tr"><span>Platform Fee</span><span>&#8377;${d.platformFee}</span></div>
    <div class="tr"><span>Taxable Value</span><span>&#8377;${d.taxableValue}</span></div>
    <div class="tr"><span>${escapeHtml(d.gstLabel)}</span><span>&#8377;${d.taxAmount}</span></div>
    <div class="tr grand"><span>Grand Total</span><span>&#8377;${d.totalAmount}</span></div>
  </div>

  <div class="foot">
    This is a computer-generated invoice and does not require a signature.
    ${d.company.supportEmail ? `For queries, contact ${escapeHtml(d.company.supportEmail)}.` : ''}
  </div>
</body>
</html>`;
}
