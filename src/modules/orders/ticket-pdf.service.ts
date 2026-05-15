import { Injectable, Logger } from '@nestjs/common';
import * as QRCode from 'qrcode';
import * as puppeteer from 'puppeteer';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';

@Injectable()
export class TicketPdfService {
  private readonly logger = new Logger(TicketPdfService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  async getOrderSummary(orderId: string): Promise<{ email: string; eventTitle: string }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        user: { select: { email: true, phone: true } },
        event: { select: { title: true } },
      },
    });
    if (!order) throw new Error(`Order ${orderId} not found`);
    return {
      email: order.user.email ?? order.user.phone ?? '',
      eventTitle: order.event.title,
    };
  }

  async generateForOrder(orderId: string): Promise<Buffer> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
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

    type AttendeeEntry = {
      fullName: string;
      ticketName: string;
      ticketCode: string;
      qrDataUrl: string;
    };

    const attendees: AttendeeEntry[] = [];
    for (const item of order.items) {
      for (const attendee of item.attendees) {
        const qrDataUrl = await QRCode.toDataURL(attendee.ticketCode, {
          width: 200,
          margin: 1,
          color: { dark: '#c0392b', light: '#ffffff' },
        });
        attendees.push({
          fullName: attendee.fullName,
          ticketName: item.ticket.name,
          ticketCode: attendee.ticketCode,
          qrDataUrl,
        });
      }
    }

    const eventDate = order.event.eventDate
      ? new Date(order.event.eventDate).toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : '';
    const venue = [order.event.venueName, order.event.city].filter(Boolean).join(', ');
    const categoryTag = order.event.category?.name?.toUpperCase() ?? '';

    const html = buildTicketHtml({
      bookingId: order.bookingId,
      eventTitle: order.event.title,
      eventDate,
      startTime: order.event.startTime ?? '',
      venue,
      categoryTag,
      coverBase64,
      attendees,
    });

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf({
        width: '800px',
        height: '360px',
        printBackground: true,
      });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }
}

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
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
          ${categoryTag ? `<div class="tag">${esc(categoryTag)}</div>` : ''}
          <h1 class="title">${esc(eventTitle)}</h1>
          <div class="details">
            ${eventDate ? `<div class="row"><span class="ico">&#128197;</span><span>${esc(eventDate)}${startTime ? ` &bull; ${esc(startTime)}` : ''}</span></div>` : ''}
            ${venue ? `<div class="row"><span class="ico">&#128205;</span><span>${esc(venue)}</span></div>` : ''}
          </div>
          <div class="att-name">${esc(a.fullName)}</div>
          <div class="att-type">${esc(a.ticketName)}</div>
        </div>
      </div>
      <div class="divider">
        <div class="sc-group top">${scallopsTop}</div>
        <div class="dash"></div>
        <div class="sc-group bot">${scallopsBot}</div>
      </div>
      <div class="right">
        <div class="brand">meetday</div>
        <div class="bk-label">Booking ID</div>
        <div class="bk-id">${esc(bookingId)}</div>
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
  .brand{font-size:10px;font-weight:700;letter-spacing:2px;color:#bbb;text-transform:uppercase;margin-bottom:4px}
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
