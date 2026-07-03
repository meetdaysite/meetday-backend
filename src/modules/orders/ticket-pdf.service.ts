import { Injectable, Logger } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { escapeHtml, renderHtmlToPdf, renderHtmlsToPdfs } from './pdf-render.util';
import { MEETDAY_LOGO_DATA_URI } from '../../common/assets/meetday-logo.base64';

const TICKET_SIZE = { width: '800px', height: '360px' };

interface RenderAttendee {
  fullName: string;
  ticketName: string;
  ticketCode: string;
  qrDataUrl: string;
  email: string | null;
  isLead: boolean;
}

interface TicketRenderData {
  bookingId: string;
  eventTitle: string;
  eventDate: string;
  startTime: string;
  venue: string;
  categoryTag: string;
  coverBase64: string;
  bookerEmail: string | null;
  attendees: RenderAttendee[];
}

function isEmail(value: string | null | undefined): value is string {
  return !!value && value.includes('@');
}

@Injectable()
export class TicketPdfService {
  private readonly logger = new Logger(TicketPdfService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  async getOrderSummary(orderId: string): Promise<{ email: string | null; eventTitle: string }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        user: { select: { email: true } },
        event: { select: { title: true } },
      },
    });
    if (!order) throw new Error(`Order ${orderId} not found`);
    return {
      email: order.user.email ?? null,
      eventTitle: order.event.title,
    };
  }

  // Generates the ticket PDF and persists it to GCS, recording the object key on
  // the order. Returns the buffer too so callers (e.g. the confirmation email)
  // reuse the same render instead of generating it twice.
  async persistForOrder(orderId: string): Promise<{ key: string; buffer: Buffer }> {
    const buffer = await this.generateForOrder(orderId);
    const key = `orders/${orderId}/ticket.pdf`;
    await this.storageService.uploadBuffer(key, buffer, 'application/pdf');
    await this.prisma.order.update({
      where: { id: orderId },
      data: { ticketPdfKey: key },
    });
    return { key, buffer };
  }

  // Returns a short-lived presigned URL for the order's ticket PDF. If the PDF
  // has not been persisted yet (orders confirmed before this feature, or whose
  // email job hasn't run), it is generated and persisted on first access.
  async getDownloadUrl(orderId: string): Promise<string> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { ticketPdfKey: true },
    });
    if (!order) throw new Error(`Order ${orderId} not found`);

    const key = order.ticketPdfKey ?? (await this.persistForOrder(orderId)).key;
    return this.storageService.getPresignedDownloadUrl(key);
  }

  // Full ticket PDF — one page per attendee. This is what gets persisted for the
  // in-app download endpoint (the booker sees every ticket in the order).
  async generateForOrder(orderId: string): Promise<Buffer> {
    const data = await this.loadTicketRenderData(orderId);
    const html = this.buildTicketHtmlFor(data, data.attendees);
    return renderHtmlToPdf(html, TICKET_SIZE);
  }

  // Splits an order's tickets into one PDF per recipient for emailing:
  //  - the booker (lead attendee) gets their own ticket(s), plus any attendee
  //    with no/invalid email folded in so nothing is lost;
  //  - every other attendee with a valid email gets only their own ticket.
  // The booker bucket is `isBooker: true` so the caller can attach the invoice.
  async generateRecipientTickets(
    orderId: string,
  ): Promise<{ eventTitle: string; recipients: Array<{ email: string; isBooker: boolean; buffer: Buffer }> }> {
    const data = await this.loadTicketRenderData(orderId);
    const bookerKey = isEmail(data.bookerEmail) ? data.bookerEmail.toLowerCase() : null;

    const buckets = new Map<string, { email: string; isBooker: boolean; attendees: RenderAttendee[] }>();
    for (const attendee of data.attendees) {
      const own = attendee.isLead ? data.bookerEmail : attendee.email;
      const foldToBooker = attendee.isLead || !isEmail(own) || (bookerKey !== null && own.toLowerCase() === bookerKey);

      let key: string;
      let email: string;
      let isBooker: boolean;
      if (foldToBooker) {
        // No booker email → can't email this bucket; the ticket stays in the download.
        if (bookerKey === null) continue;
        key = bookerKey;
        email = data.bookerEmail as string;
        isBooker = true;
      } else {
        key = (own as string).toLowerCase();
        email = own as string;
        isBooker = false;
      }

      const bucket = buckets.get(key) ?? { email, isBooker, attendees: [] };
      bucket.attendees.push(attendee);
      buckets.set(key, bucket);
    }

    const list = [...buckets.values()];
    const htmls = list.map((b) => this.buildTicketHtmlFor(data, b.attendees));
    const pdfs = await renderHtmlsToPdfs(htmls, TICKET_SIZE);

    return {
      eventTitle: data.eventTitle,
      recipients: list.map((b, i) => ({ email: b.email, isBooker: b.isBooker, buffer: pdfs[i] })),
    };
  }

  private buildTicketHtmlFor(data: TicketRenderData, attendees: RenderAttendee[]): string {
    return buildTicketHtml({
      bookingId: data.bookingId,
      eventTitle: data.eventTitle,
      eventDate: data.eventDate,
      startTime: data.startTime,
      venue: data.venue,
      categoryTag: data.categoryTag,
      coverBase64: data.coverBase64,
      attendees,
    });
  }

  private async loadTicketRenderData(orderId: string): Promise<TicketRenderData> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: { select: { email: true } },
        event: {
          select: {
            title: true,
            eventDate: true,
            startTime: true,
            venueName: true,
            city: true,
            category: { select: { name: true } },
            media: {
              where: { type: 'COVER' },
              select: { url: true },
              take: 1,
            },
          },
        },
        items: {
          include: {
            ticket: { select: { name: true } },
            attendees: { orderBy: { isLead: 'desc' } },
          },
        },
      },
    });

    if (!order) throw new Error(`Order ${orderId} not found`);

    let coverBase64 = '';
    const coverKey = order.event.media[0]?.url;
    if (coverKey) {
      try {
        const signedUrl = await this.storageService.getPresignedDownloadUrl(coverKey);
        const res = await fetch(signedUrl);
        const buf = Buffer.from(await res.arrayBuffer());
        const mime = res.headers.get('content-type') ?? 'image/jpeg';
        coverBase64 = `data:${mime};base64,${buf.toString('base64')}`;
      } catch (err) {
        this.logger.warn(`Could not fetch cover image for order ${orderId}: ${(err as Error).message}`);
      }
    }

    const attendees: RenderAttendee[] = await Promise.all(
      order.items.flatMap((item) =>
        item.attendees.map(async (attendee) => ({
          fullName: attendee.fullName,
          ticketName: item.ticket.name,
          ticketCode: attendee.ticketCode,
          email: attendee.email,
          isLead: attendee.isLead,
          qrDataUrl: await QRCode.toDataURL(attendee.ticketCode, {
            width: 200,
            margin: 1,
            color: { dark: '#c0392b', light: '#ffffff' },
          }),
        })),
      ),
    );

    const eventDate = order.event.eventDate
      ? new Date(order.event.eventDate).toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : '';

    return {
      bookingId: order.bookingId,
      eventTitle: order.event.title,
      eventDate,
      startTime: order.event.startTime ?? '',
      venue: [order.event.venueName, order.event.city].filter(Boolean).join(', '),
      categoryTag: order.event.category?.name?.toUpperCase() ?? '',
      coverBase64,
      bookerEmail: order.user.email ?? null,
      attendees,
    };
  }
}

function buildTicketHtml(opts: {
  bookingId: string;
  eventTitle: string;
  eventDate: string;
  startTime: string;
  venue: string;
  categoryTag: string;
  coverBase64: string;
  attendees: Array<{ fullName: string; ticketName: string; ticketCode: string; qrDataUrl: string }>;
}): string {
  const { bookingId, eventTitle, eventDate, startTime, venue, categoryTag, coverBase64, attendees } = opts;

  const scallopCount = 10;
  const scallopsTop = Array.from({ length: scallopCount }).map(() => '<div class="sc-top"></div>').join('');
  const scallopsBot = Array.from({ length: scallopCount }).map(() => '<div class="sc-bot"></div>').join('');

  const pages = attendees
    .map(
      (a) => `
    <div class="ticket">
      <div class="left" style="${coverBase64 ? `background-image:url('${coverBase64}');` : ''}">
        <div class="overlay">
          ${categoryTag ? `<div class="tag">${escapeHtml(categoryTag)}</div>` : ''}
          <h1 class="title">${escapeHtml(eventTitle)}</h1>
          <div class="details">
            ${eventDate ? `<div class="row"><span class="ico">&#128197;</span><span>${escapeHtml(eventDate)}${startTime ? ` &bull; ${escapeHtml(startTime)}` : ''}</span></div>` : ''}
            ${venue ? `<div class="row"><span class="ico">&#128205;</span><span>${escapeHtml(venue)}</span></div>` : ''}
          </div>
          <div class="att-name">${escapeHtml(a.fullName)}</div>
          <div class="att-type">${escapeHtml(a.ticketName)}</div>
        </div>
      </div>
      <div class="divider">
        <div class="sc-group top">${scallopsTop}</div>
        <div class="dash"></div>
        <div class="sc-group bot">${scallopsBot}</div>
      </div>
      <div class="right">
        <div class="brand-logo"></div>
        <div class="bk-label">Booking ID</div>
        <div class="bk-id">${escapeHtml(bookingId)}</div>
        <div class="qr-box">
          <img src="${a.qrDataUrl}" alt="QR" />
        </div>
        <div class="confirmed">&#10003;&nbsp;Ticket Confirmed</div>
      </div>
    </div>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Helvetica Neue',Arial,sans-serif;background:#ebebeb}
  .ticket{
    display:flex;width:800px;height:360px;
    background:#fff;border-radius:16px;overflow:hidden;
    page-break-after:always;
  }
  /* Left panel */
  .left{
    flex:0 0 62%;
    background:#1a1a2e no-repeat center/cover;
  }
  .overlay{
    width:100%;height:100%;
    background:linear-gradient(to bottom,rgba(0,0,0,.1) 0%,rgba(0,0,0,.65) 55%,rgba(0,0,0,.88) 100%);
    display:flex;flex-direction:column;justify-content:flex-end;
    padding:24px 28px;
  }
  .tag{
    font-size:10px;font-weight:700;letter-spacing:1.5px;color:#ff6b6b;
    background:rgba(255,255,255,.1);border:1px solid rgba(255,107,107,.55);
    border-radius:4px;padding:3px 10px;align-self:flex-start;margin-bottom:10px;
  }
  .title{
    font-size:23px;font-weight:800;color:#fff;line-height:1.2;
    margin-bottom:12px;text-shadow:0 2px 8px rgba(0,0,0,.5);
  }
  .details{margin-bottom:14px}
  .row{display:flex;align-items:center;gap:7px;color:rgba(255,255,255,.88);font-size:12px;margin-bottom:5px}
  .ico{font-size:13px}
  .att-name{font-size:15px;font-weight:700;color:#fff;margin-bottom:2px}
  .att-type{font-size:11px;color:rgba(255,255,255,.6);letter-spacing:.4px}
  /* Divider */
  .divider{
    flex:0 0 20px;display:flex;flex-direction:column;align-items:center;
    background:#ebebeb;overflow:visible;position:relative;z-index:1;
  }
  .sc-group{display:flex;flex-direction:column;align-items:center}
  .sc-top,.sc-bot{width:20px;height:10px;background:#ebebeb}
  .sc-top{border-radius:0 0 10px 10px}
  .sc-bot{border-radius:10px 10px 0 0}
  .dash{flex:1;border-left:2px dashed #ccc;width:0}
  /* Right panel */
  .right{
    flex:1;display:flex;flex-direction:column;align-items:center;
    justify-content:center;padding:20px 22px;gap:5px;background:#fff;
  }
  .brand-logo{width:40px;height:40px;margin-bottom:4px;background:center/contain no-repeat url('${MEETDAY_LOGO_DATA_URI}')}
  .bk-label{font-size:10px;color:#999;letter-spacing:1px;text-transform:uppercase}
  .bk-id{font-family:'Courier New',monospace;font-size:18px;font-weight:800;color:#c0392b;letter-spacing:1px;margin-bottom:6px}
  .qr-box{border:2px solid #c0392b;border-radius:8px;padding:8px;background:#fff}
  .qr-box img{width:120px;height:120px;display:block}
  .confirmed{
    margin-top:8px;background:#eafaf1;color:#27ae60;
    font-size:11px;font-weight:700;padding:4px 14px;
    border-radius:20px;border:1px solid #a9dfbf;
  }
</style>
</head>
<body>${pages}</body>
</html>`;
}
