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

@Injectable()
export class CheckInService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async createScannerSession(hostUserId: string, eventId: string, dto: CreateScannerSessionDto) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { hostProfile: { select: { userId: true } } },
    });
    if (!event) throw new NotFoundException('Event not found');
    if (event.hostProfile.userId !== hostUserId) throw new ForbiddenException('You do not own this event');

    const expiresAt = new Date(dto.expiresAt);
    if (expiresAt <= new Date()) throw new BadRequestException('expiresAt must be in the future');

    const token = randomBytes(32).toString('hex');

    const session = await this.prisma.eventScannerSession.create({
      data: {
        eventId,
        label: dto.label,
        token,
        expiresAt,
        createdByUserId: hostUserId,
      },
    });

    const appUrl = this.configService.get<string>('app.url') ?? 'https://app.meetday.app';
    return { ...session, scannerUrl: `${appUrl}/scan?token=${token}` };
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

    const appUrl = this.configService.get<string>('app.url') ?? 'https://app.meetday.app';
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
      orderBy: { createdAt: 'asc' },
    });

    return {
      totalAttendees: totalCount,
      checkedIn: checkedInCount,
      remaining: totalCount - checkedInCount,
      bySession: sessions.map((s) => ({
        id: s.id,
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
      include: { event: { select: { id: true, title: true, eventDate: true, venueName: true, city: true } } },
    });

    if (!session) throw new UnauthorizedException('Invalid scanner link');
    if (!session.isActive) throw new GoneException('This scanner link has been deactivated');
    if (session.expiresAt <= new Date()) throw new GoneException('This scanner link has expired');

    return {
      sessionId: session.id,
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
        orderItem: {
          include: {
            ticket: { select: { name: true } },
            order: { select: { eventId: true, status: true } },
          },
        },
      },
    });

    if (!attendee) throw new NotFoundException('Ticket not found');
    if (attendee.orderItem.order.eventId !== session.eventId)
      throw new BadRequestException('Ticket does not belong to this event');
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
