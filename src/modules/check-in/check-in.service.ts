import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateScannerSessionDto } from './dto/create-scanner-session.dto';
import { ScanTicketDto } from './dto/scan-ticket.dto';
import { AuditLogService } from '../audit-log/audit-log.service';
import { MailService } from '../../common/mail/mail.service';
import { getEventEndAt, parseTimeOfDay } from '../events/event-time.util';

@Injectable()
export class CheckInService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly auditLogService: AuditLogService,
    private readonly mailService: MailService,
  ) {}

  async createScannerSession(hostUserId: string, eventId: string, dto: CreateScannerSessionDto) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        title: true,
        eventDate: true,
        endTime: true,
        hostProfile: { select: { userId: true } },
      },
    });
    if (!event) throw new NotFoundException('Event not found');
    if (event.hostProfile.userId !== hostUserId) throw new ForbiddenException('You do not own this event');

    if (!event.eventDate || !event.endTime) {
      throw new BadRequestException('Event must have a date and end time set before inviting scanner staff');
    }

    if (!parseTimeOfDay(event.endTime)) throw new BadRequestException(`Unrecognised endTime format: "${event.endTime}"`);
    const expiresAt = new Date(getEventEndAt(event)!.getTime() + 60 * 60 * 1000); // 1-hour buffer after event ends

    const token = randomBytes(32).toString('hex');

    const session = await this.prisma.eventScannerSession.create({
      data: {
        eventId,
        staffName: dto.name,
        staffEmail: dto.email,
        staffPhone: dto.phone,
        label: dto.label,
        token,
        expiresAt,
        createdByUserId: hostUserId,
      },
    });

    this.auditLogService.log({
      actorId: hostUserId,
      actorRole: 'HOST',
      action: 'SCANNER_SESSION_CREATED',
      entityType: 'SCANNER_SESSION',
      entityId: session.id,
      metadata: { eventId, staffEmail: dto.email, label: dto.label ?? null, expiresAt: session.expiresAt },
    });

    const appUrl = this.configService.get<string>('frontendUrl');
    const scannerUrl = `${appUrl}/host/scan?token=${token}`;

    void this.mailService
      .sendScannerInvite(dto.email, dto.name, event.title, scannerUrl, expiresAt)
      .catch(() => {});

    return { ...session, scannerUrl };
  }

  async listScannerSessions(hostUserId: string, eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { hostProfile: { select: { userId: true } } },
    });
    if (!event) throw new NotFoundException('Event not found');
    if (event.hostProfile.userId !== hostUserId) throw new ForbiddenException('You do not own this event');

    const sessions = await this.prisma.eventScannerSession.findMany({
      where: { eventId },
      include: { _count: { select: { checkIns: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const appUrl = this.configService.get<string>('frontendUrl');
    return sessions.map((s) => ({
      ...s,
      checkInCount: s._count.checkIns,
      scannerUrl: `${appUrl}/scan?token=${s.token}`,
    }));
  }

  async deactivateScannerSession(hostUserId: string, eventId: string, sessionId: string) {
    const session = await this.prisma.eventScannerSession.findUnique({
      where: { id: sessionId },
      include: { event: { include: { hostProfile: { select: { userId: true } } } } },
    });
    if (!session) throw new NotFoundException('Scanner session not found');
    if (session.eventId !== eventId) throw new NotFoundException('Scanner session not found');
    if (session.event.hostProfile.userId !== hostUserId) throw new ForbiddenException('You do not own this event');
    if (!session.isActive) throw new BadRequestException('Session is already inactive');

    return this.prisma.eventScannerSession.update({
      where: { id: sessionId },
      data: { isActive: false },
    });
  }

  async getCheckInStats(hostUserId: string, eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { hostProfile: { select: { userId: true } } },
    });
    if (!event) throw new NotFoundException('Event not found');
    if (event.hostProfile.userId !== hostUserId) throw new ForbiddenException('You do not own this event');

    // Total attendees across all confirmed orders for this event
    const totalCount = await this.prisma.orderAttendee.count({
      where: { orderItem: { order: { eventId, status: 'CONFIRMED' } } },
    });

    const checkedInCount = await this.prisma.orderAttendee.count({
      where: {
        orderItem: { order: { eventId, status: 'CONFIRMED' } },
        checkedInAt: { not: null },
      },
    });

    // Per-session breakdown
    const sessions = await this.prisma.eventScannerSession.findMany({
      where: { eventId },
      include: { _count: { select: { checkIns: true } } },
      orderBy: { id: 'asc' },
    });

    return {
      totalAttendees: totalCount,
      checkedIn: checkedInCount,
      remaining: totalCount - checkedInCount,
      bySession: sessions.map((s) => ({
        id: s.id,
        staffName: s.staffName,
        staffEmail: s.staffEmail,
        label: s.label,
        isActive: s.isActive,
        expiresAt: s.expiresAt,
        checkInCount: s._count.checkIns,
      })),
    };
  }

  // ─── Public scanner endpoints ─────────────────────────────────────────────

  async verifySession(token: string) {
    const session = await this.prisma.eventScannerSession.findUnique({
      where: { token },
      include: { event: { select: { id: true, title: true, eventDate: true, startTime: true, endTime: true, venueName: true, city: true } } },
    });

    if (!session) throw new UnauthorizedException('Invalid scanner link');
    if (!session.isActive) throw new GoneException('This scanner link has been deactivated');
    if (session.expiresAt <= new Date()) throw new GoneException('This scanner link has expired');

    return {
      sessionId: session.id,
      staffName: session.staffName,
      label: session.label,
      event: session.event,
    };
  }

  async scanTicket(dto: ScanTicketDto) {
    const session = await this.prisma.eventScannerSession.findUnique({
      where: { token: dto.scannerToken },
      select: { id: true, eventId: true, isActive: true, expiresAt: true },
    });

    if (!session) throw new UnauthorizedException('Invalid scanner token');
    if (!session.isActive) throw new GoneException('This scanner session has been deactivated');
    if (session.expiresAt <= new Date()) throw new GoneException('This scanner session has expired');

    const attendee = await this.prisma.orderAttendee.findUnique({
      where: { ticketCode: dto.ticketCode },
      include: {
        scannedBySession: { select: { label: true, staffName: true } },
        orderItem: {
          include: {
            ticket: { select: { name: true } },
            attendees: { select: { id: true, checkedInAt: true }, orderBy: { id: 'asc' } },
            order: {
              select: {
                bookingId: true,
                eventId: true,
                status: true,
                event: { select: { status: true } },
              },
            },
          },
        },
      },
    });

    if (!attendee) throw new NotFoundException('Ticket not found');
    if (attendee.orderItem.order.eventId !== session.eventId)
      throw new BadRequestException('Ticket does not belong to this event');
    if (attendee.orderItem.order.event.status !== 'PUBLISHED')
      throw new BadRequestException('This event has been cancelled');
    if (attendee.orderItem.order.status !== 'CONFIRMED')
      throw new BadRequestException('Ticket order is not confirmed');

    if (attendee.checkedInAt) {
      this.auditLogService.log({
        action: 'DUPLICATE_SCAN_ATTEMPT',
        entityType: 'ORDER',
        entityId: attendee.orderItem.order.eventId,
        metadata: {
          attendeeId: attendee.id,
          ticketCode: dto.ticketCode,
          scannerSessionId: session.id,
          originalCheckedInAt: attendee.checkedInAt,
        },
      });

      const gateName =
        attendee.scannedBySession?.label ??
        attendee.scannedBySession?.staffName ??
        'Unknown gate';

      return {
        alreadyCheckedIn: true,
        checkedInAt: attendee.checkedInAt,
        ticketCodeSuffix: dto.ticketCode.slice(-4),
        gateName,
        order: this.buildGroupView(attendee.orderItem),
      };
    }

    await this.prisma.orderAttendee.update({
      where: { id: attendee.id },
      data: { checkedInAt: new Date(), scannedBySessionId: session.id },
    });

    // Re-fetch siblings for accurate post-update counts
    const siblings = await this.prisma.orderAttendee.findMany({
      where: { orderItemId: attendee.orderItemId },
      select: { id: true, checkedInAt: true },
      orderBy: { id: 'asc' },
    });

    this.auditLogService.log({
      action: 'TICKET_SCANNED',
      entityType: 'ORDER',
      entityId: attendee.orderItem.order.eventId,
      metadata: {
        attendeeId: attendee.id,
        ticketCode: dto.ticketCode,
        scannerSessionId: session.id,
        ticketName: attendee.orderItem.ticket.name,
      },
    });

    return {
      alreadyCheckedIn: false,
      checkedInAt: new Date(),
      order: this.buildGroupView({ ...attendee.orderItem, attendees: siblings }),
    };
  }

  private buildGroupView(orderItem: {
    order: { bookingId: string };
    ticket: { name: string };
    attendees: { id: string; checkedInAt: Date | null }[];
  }) {
    const entries = orderItem.attendees.map((a, i) => ({
      position: i + 1,
      isCheckedIn: !!a.checkedInAt,
    }));
    return {
      bookingCode: orderItem.order.bookingId,
      ticketType: orderItem.ticket.name,
      totalEntries: entries.length,
      checkedInCount: entries.filter((e) => e.isCheckedIn).length,
      entries,
    };
  }

  async getScannerLiveStats(token: string) {
    const session = await this.prisma.eventScannerSession.findUnique({
      where: { token },
      select: { id: true, eventId: true, isActive: true, expiresAt: true },
    });

    if (!session) throw new UnauthorizedException('Invalid scanner token');
    if (!session.isActive) throw new GoneException('This scanner session has been deactivated');
    if (session.expiresAt <= new Date()) throw new GoneException('This scanner session has expired');

    const [checkedInThisGate, totalRemaining] = await Promise.all([
      this.prisma.orderAttendee.count({
        where: { scannedBySessionId: session.id },
      }),
      this.prisma.orderAttendee.count({
        where: {
          orderItem: { order: { eventId: session.eventId, status: 'CONFIRMED' } },
          checkedInAt: null,
        },
      }),
    ]);

    return { checkedInThisGate, totalRemaining };
  }

  async lookupForManualCheckIn(
    token: string,
    params: { bookingId?: string; ticketCode?: string },
  ) {
    if (!params.bookingId && !params.ticketCode) {
      throw new BadRequestException('Provide either bookingId or ticketCode');
    }
    if (params.bookingId && params.ticketCode) {
      throw new BadRequestException('Provide only one of bookingId or ticketCode, not both');
    }

    const session = await this.prisma.eventScannerSession.findUnique({
      where: { token },
      select: { id: true, eventId: true, isActive: true, expiresAt: true },
    });

    if (!session) throw new UnauthorizedException('Invalid scanner token');
    if (!session.isActive) throw new GoneException('This scanner session has been deactivated');
    if (session.expiresAt <= new Date()) throw new GoneException('This scanner session has expired');

    let orderId: string;

    if (params.ticketCode) {
      const attendee = await this.prisma.orderAttendee.findUnique({
        where: { ticketCode: params.ticketCode },
        select: { orderItem: { select: { orderId: true } } },
      });
      if (!attendee) throw new NotFoundException('Ticket not found');
      orderId = attendee.orderItem.orderId;
    } else {
      const found = await this.prisma.order.findFirst({
        where: { bookingId: params.bookingId, eventId: session.eventId },
        select: { id: true },
      });
      if (!found) throw new NotFoundException('Booking not found for this event');
      orderId = found.id;
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        bookingId: true,
        eventId: true,
        status: true,
        items: {
          select: {
            id: true,
            ticket: { select: { name: true } },
            attendees: { select: { checkedInAt: true } },
          },
        },
      },
    });

    if (!order || order.eventId !== session.eventId)
      throw new NotFoundException('Booking not found for this event');

    return {
      bookingCode: order.bookingId,
      orderStatus: order.status,
      items: order.items.map((item) => ({
        orderItemId: item.id,
        ticketType: item.ticket.name,
        totalEntries: item.attendees.length,
        checkedInCount: item.attendees.filter((a) => !!a.checkedInAt).length,
      })),
    };
  }

  async manualCheckIn(dto: { attendeeId: string; scannerToken: string }) {
    const session = await this.prisma.eventScannerSession.findUnique({
      where: { token: dto.scannerToken },
      select: { id: true, eventId: true, isActive: true, expiresAt: true },
    });

    if (!session) throw new UnauthorizedException('Invalid scanner token');
    if (!session.isActive) throw new GoneException('This scanner session has been deactivated');
    if (session.expiresAt <= new Date()) throw new GoneException('This scanner session has expired');

    const attendee = await this.prisma.orderAttendee.findUnique({
      where: { id: dto.attendeeId },
      include: {
        orderItem: {
          include: {
            ticket: { select: { name: true } },
            order: {
              select: {
                eventId: true,
                status: true,
                event: { select: { status: true } },
              },
            },
          },
        },
      },
    });

    if (!attendee) throw new NotFoundException('Attendee not found');
    if (attendee.orderItem.order.eventId !== session.eventId)
      throw new BadRequestException('Attendee does not belong to this event');
    if (attendee.orderItem.order.event.status !== 'PUBLISHED')
      throw new BadRequestException('This event has been cancelled');
    if (attendee.orderItem.order.status !== 'CONFIRMED')
      throw new BadRequestException('Ticket order is not confirmed');

    if (attendee.checkedInAt) {
      return {
        alreadyCheckedIn: true,
        checkedInAt: attendee.checkedInAt,
        attendee: {
          fullName: attendee.fullName,
          ticketName: attendee.orderItem.ticket.name,
          isLead: attendee.isLead,
        },
      };
    }

    const updated = await this.prisma.orderAttendee.update({
      where: { id: attendee.id },
      data: { checkedInAt: new Date(), scannedBySessionId: session.id },
      include: { orderItem: { include: { ticket: { select: { name: true } } } } },
    });

    this.auditLogService.log({
      action: 'TICKET_SCANNED',
      entityType: 'ORDER',
      entityId: attendee.orderItem.order.eventId,
      metadata: {
        attendeeId: attendee.id,
        method: 'manual',
        scannerSessionId: session.id,
        ticketName: updated.orderItem.ticket.name,
      },
    });

    return {
      alreadyCheckedIn: false,
      checkedInAt: updated.checkedInAt,
      attendee: {
        fullName: updated.fullName,
        ticketName: updated.orderItem.ticket.name,
        isLead: updated.isLead,
      },
    };
  }
}
