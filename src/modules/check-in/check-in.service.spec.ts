import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CheckInService } from './check-in.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { MailService } from '../../common/mail/mail.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePrisma() {
  const prisma: any = {
    event: { findUnique: jest.fn() },
    eventScannerSession: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    orderAttendee: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    order: { findFirst: jest.fn(), findUnique: jest.fn() },
  };
  return prisma;
}

const mockConfig = { get: jest.fn().mockReturnValue('http://localhost:3000') };
const mockAuditLog = { log: jest.fn() };
const mockMail = { sendScannerInvite: jest.fn().mockResolvedValue(undefined) };

// ── Fixtures ──────────────────────────────────────────────────────────────────

const hostUserId = 'host-uuid';
const eventId = 'event-uuid';
const sessionId = 'session-uuid';

const ownedEvent = {
  title: 'Test Event',
  eventDate: new Date('2026-06-01'),
  endTime: '10:00 PM',
  hostProfile: { userId: hostUserId },
};

const activeSession = {
  id: sessionId,
  token: 'valid-token-abc',
  eventId,
  isActive: true,
  expiresAt: new Date(Date.now() + 3600_000),
  staffName: 'Scanner Staff',
  staffEmail: 'staff@test.com',
  label: 'Gate A',
  _count: { checkIns: 5 },
  event: { id: eventId, title: 'Test Event', eventDate: new Date(), startTime: '07:00 PM', endTime: '10:00 PM', venueName: 'Venue', city: 'Mumbai' },
};

// ── Test suite ────────────────────────────────────────────────────────────────

describe('CheckInService', () => {
  let service: CheckInService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();

    const module = await Test.createTestingModule({
      providers: [
        CheckInService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: mockConfig },
        { provide: AuditLogService, useValue: mockAuditLog },
        { provide: MailService, useValue: mockMail },
      ],
    }).compile();

    service = module.get(CheckInService);
    jest.clearAllMocks();
    mockConfig.get.mockReturnValue('http://localhost:3000');
  });

  // ── createScannerSession ──────────────────────────────────────────────────

  describe('createScannerSession()', () => {
    const dto = { name: 'Lamine', email: 'lamine@test.com', phone: undefined, label: 'Gate A' };

    beforeEach(() => {
      prisma.event.findUnique.mockResolvedValue(ownedEvent);
      prisma.eventScannerSession.create.mockResolvedValue({
        ...activeSession,
        id: sessionId,
        token: 'gen-token',
      });
    });

    it('creates session and returns scannerUrl with frontendUrl', async () => {
      const result = await service.createScannerSession(hostUserId, eventId, dto);
      expect(result.scannerUrl).toMatch(/^http:\/\/localhost:3000\/scan\?token=/);
      expect(prisma.eventScannerSession.create).toHaveBeenCalled();
    });

    it('parses 12-hour PM time correctly', async () => {
      prisma.event.findUnique.mockResolvedValue({ ...ownedEvent, endTime: '01:00 PM' });
      await service.createScannerSession(hostUserId, eventId, dto);
      const createCall = prisma.eventScannerSession.create.mock.calls[0][0].data;
      expect(createCall.expiresAt).toBeInstanceOf(Date);
      expect(isNaN(createCall.expiresAt.getTime())).toBe(false);
      // 1 PM + 1h buffer = 14:00
      expect(createCall.expiresAt.getHours()).toBe(14);
    });

    it('parses 12:00 AM (midnight) correctly', async () => {
      prisma.event.findUnique.mockResolvedValue({ ...ownedEvent, endTime: '12:00 AM' });
      await service.createScannerSession(hostUserId, eventId, dto);
      const createCall = prisma.eventScannerSession.create.mock.calls[0][0].data;
      // midnight (0h) + 1h buffer = 1:00
      expect(createCall.expiresAt.getHours()).toBe(1);
    });

    it('parses 12:00 PM (noon) correctly', async () => {
      prisma.event.findUnique.mockResolvedValue({ ...ownedEvent, endTime: '12:00 PM' });
      await service.createScannerSession(hostUserId, eventId, dto);
      const createCall = prisma.eventScannerSession.create.mock.calls[0][0].data;
      // noon (12h) + 1h buffer = 13:00
      expect(createCall.expiresAt.getHours()).toBe(13);
    });

    it('parses 24-hour time format correctly', async () => {
      prisma.event.findUnique.mockResolvedValue({ ...ownedEvent, endTime: '22:00' });
      await service.createScannerSession(hostUserId, eventId, dto);
      const createCall = prisma.eventScannerSession.create.mock.calls[0][0].data;
      expect(createCall.expiresAt.getHours()).toBe(23); // 22:00 + 1h
    });

    it('throws BadRequestException for unrecognised endTime format', async () => {
      prisma.event.findUnique.mockResolvedValue({ ...ownedEvent, endTime: 'invalid-time' });
      await expect(service.createScannerSession(hostUserId, eventId, dto)).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when event does not exist', async () => {
      prisma.event.findUnique.mockResolvedValue(null);
      await expect(service.createScannerSession(hostUserId, eventId, dto)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when user does not own the event', async () => {
      prisma.event.findUnique.mockResolvedValue({ ...ownedEvent, hostProfile: { userId: 'other' } });
      await expect(service.createScannerSession(hostUserId, eventId, dto)).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when event has no date or endTime', async () => {
      prisma.event.findUnique.mockResolvedValue({ ...ownedEvent, eventDate: null });
      await expect(service.createScannerSession(hostUserId, eventId, dto)).rejects.toThrow(BadRequestException);
    });
  });

  // ── verifySession ─────────────────────────────────────────────────────────

  describe('verifySession()', () => {
    it('returns session info for a valid active token', async () => {
      prisma.eventScannerSession.findUnique.mockResolvedValue(activeSession);
      const result = await service.verifySession('valid-token-abc');
      expect(result).toMatchObject({ sessionId, staffName: 'Scanner Staff' });
    });

    it('throws UnauthorizedException for an unknown token', async () => {
      prisma.eventScannerSession.findUnique.mockResolvedValue(null);
      await expect(service.verifySession('bad-token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws GoneException when session is deactivated', async () => {
      prisma.eventScannerSession.findUnique.mockResolvedValue({ ...activeSession, isActive: false });
      await expect(service.verifySession('valid-token-abc')).rejects.toThrow(GoneException);
    });

    it('throws GoneException when session is expired', async () => {
      prisma.eventScannerSession.findUnique.mockResolvedValue({
        ...activeSession,
        expiresAt: new Date(Date.now() - 1000),
      });
      await expect(service.verifySession('valid-token-abc')).rejects.toThrow(GoneException);
    });
  });

  // ── deactivateScannerSession ──────────────────────────────────────────────

  describe('deactivateScannerSession()', () => {
    const sessionRecord = {
      id: sessionId,
      eventId,
      isActive: true,
      event: { hostProfile: { userId: hostUserId } },
    };

    beforeEach(() => {
      prisma.eventScannerSession.findUnique.mockResolvedValue(sessionRecord);
      prisma.eventScannerSession.update.mockResolvedValue({ ...sessionRecord, isActive: false });
    });

    it('deactivates an active session', async () => {
      await service.deactivateScannerSession(hostUserId, eventId, sessionId);
      expect(prisma.eventScannerSession.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isActive: false } }),
      );
    });

    it('throws NotFoundException when session does not exist', async () => {
      prisma.eventScannerSession.findUnique.mockResolvedValue(null);
      await expect(service.deactivateScannerSession(hostUserId, eventId, sessionId)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when session belongs to a different event', async () => {
      prisma.eventScannerSession.findUnique.mockResolvedValue({ ...sessionRecord, eventId: 'other-event' });
      await expect(service.deactivateScannerSession(hostUserId, eventId, sessionId)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when user does not own the event', async () => {
      prisma.eventScannerSession.findUnique.mockResolvedValue({
        ...sessionRecord,
        event: { hostProfile: { userId: 'other' } },
      });
      await expect(service.deactivateScannerSession(hostUserId, eventId, sessionId)).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when session is already inactive', async () => {
      prisma.eventScannerSession.findUnique.mockResolvedValue({ ...sessionRecord, isActive: false });
      await expect(service.deactivateScannerSession(hostUserId, eventId, sessionId)).rejects.toThrow(BadRequestException);
    });
  });

  // ── scanTicket ────────────────────────────────────────────────────────────

  describe('scanTicket()', () => {
    const scanDto = { scannerToken: 'valid-token-abc', ticketCode: 'MDAY-TICKET-001' };

    const attendeeRecord = {
      id: 'att-uuid',
      ticketCode: 'MDAY-TICKET-001',
      checkedInAt: null,
      fullName: 'Riya Sen',
      isLead: true,
      orderItemId: 'oi-uuid',
      scannedBySession: null,
      orderItem: {
        orderId: 'order-uuid',
        ticket: { name: 'General' },
        attendees: [{ id: 'att-uuid', checkedInAt: null }],
        order: {
          bookingId: 'MDAY-AA-BB',
          eventId,
          status: 'CONFIRMED',
          event: { status: 'PUBLISHED' },
        },
      },
    };

    beforeEach(() => {
      prisma.eventScannerSession.findUnique.mockResolvedValue({
        ...activeSession,
        token: 'valid-token-abc',
      });
      prisma.orderAttendee.findUnique.mockResolvedValue(attendeeRecord);
      prisma.orderAttendee.update.mockResolvedValue({ ...attendeeRecord, checkedInAt: new Date() });
      prisma.orderAttendee.findMany.mockResolvedValue([{ id: 'att-uuid', checkedInAt: new Date() }]);
    });

    it('successfully scans a valid ticket', async () => {
      const result = await service.scanTicket(scanDto);
      expect(result.alreadyCheckedIn).toBe(false);
      expect(prisma.orderAttendee.update).toHaveBeenCalled();
    });

    it('returns alreadyCheckedIn=true for a duplicate scan', async () => {
      prisma.orderAttendee.findUnique.mockResolvedValue({
        ...attendeeRecord,
        checkedInAt: new Date(),
        scannedBySession: { label: 'Gate A', staffName: 'Scanner' },
      });
      const result = await service.scanTicket(scanDto);
      expect(result.alreadyCheckedIn).toBe(true);
      expect(prisma.orderAttendee.update).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException for an invalid scanner token', async () => {
      prisma.eventScannerSession.findUnique.mockResolvedValue(null);
      await expect(service.scanTicket(scanDto)).rejects.toThrow(UnauthorizedException);
    });

    it('throws GoneException when session is expired', async () => {
      prisma.eventScannerSession.findUnique.mockResolvedValue({
        ...activeSession,
        expiresAt: new Date(Date.now() - 1000),
      });
      await expect(service.scanTicket(scanDto)).rejects.toThrow(GoneException);
    });

    it('throws NotFoundException when ticket code does not exist', async () => {
      prisma.orderAttendee.findUnique.mockResolvedValue(null);
      await expect(service.scanTicket(scanDto)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when ticket belongs to a different event', async () => {
      prisma.orderAttendee.findUnique.mockResolvedValue({
        ...attendeeRecord,
        orderItem: {
          ...attendeeRecord.orderItem,
          order: { ...attendeeRecord.orderItem.order, eventId: 'other-event' },
        },
      });
      await expect(service.scanTicket(scanDto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the order is not confirmed', async () => {
      prisma.orderAttendee.findUnique.mockResolvedValue({
        ...attendeeRecord,
        orderItem: {
          ...attendeeRecord.orderItem,
          order: { ...attendeeRecord.orderItem.order, status: 'PENDING_PAYMENT' },
        },
      });
      await expect(service.scanTicket(scanDto)).rejects.toThrow(BadRequestException);
    });
  });

  // ── lookupForManualCheckIn ────────────────────────────────────────────────

  describe('lookupForManualCheckIn()', () => {
    beforeEach(() => {
      prisma.eventScannerSession.findUnique.mockResolvedValue({ ...activeSession, token: 'valid-token-abc' });
    });

    it('throws BadRequestException when neither bookingId nor ticketCode is provided', async () => {
      await expect(service.lookupForManualCheckIn('valid-token-abc', {})).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when both bookingId and ticketCode are provided', async () => {
      await expect(
        service.lookupForManualCheckIn('valid-token-abc', { bookingId: 'X', ticketCode: 'Y' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns booking details via ticketCode', async () => {
      prisma.orderAttendee.findUnique.mockResolvedValue({ orderItem: { orderId: 'order-uuid' } });
      prisma.order.findUnique.mockResolvedValue({
        bookingId: 'MDAY-AA-BB',
        eventId,
        status: 'CONFIRMED',
        items: [{ id: 'oi-1', ticket: { name: 'General' }, attendees: [{ checkedInAt: null }] }],
      });

      const result = await service.lookupForManualCheckIn('valid-token-abc', { ticketCode: 'MDAY-TICKET-001' });
      expect(result.bookingCode).toBe('MDAY-AA-BB');
      expect(result.items).toHaveLength(1);
    });

    it('returns booking details via bookingId', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'order-uuid' });
      prisma.order.findUnique.mockResolvedValue({
        bookingId: 'MDAY-AA-BB',
        eventId,
        status: 'CONFIRMED',
        items: [{ id: 'oi-1', ticket: { name: 'General' }, attendees: [{ checkedInAt: null }] }],
      });

      const result = await service.lookupForManualCheckIn('valid-token-abc', { bookingId: 'MDAY-AA-BB' });
      expect(result.bookingCode).toBe('MDAY-AA-BB');
    });

    it('throws NotFoundException when ticketCode does not exist', async () => {
      prisma.orderAttendee.findUnique.mockResolvedValue(null);
      await expect(service.lookupForManualCheckIn('valid-token-abc', { ticketCode: 'INVALID' })).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when bookingId is not found for this event', async () => {
      prisma.order.findFirst.mockResolvedValue(null);
      await expect(service.lookupForManualCheckIn('valid-token-abc', { bookingId: 'INVALID' })).rejects.toThrow(NotFoundException);
    });

    it('throws UnauthorizedException for an invalid scanner token', async () => {
      prisma.eventScannerSession.findUnique.mockResolvedValue(null);
      await expect(service.lookupForManualCheckIn('bad-token', { bookingId: 'X' })).rejects.toThrow(UnauthorizedException);
    });

    it('throws GoneException when session is deactivated', async () => {
      prisma.eventScannerSession.findUnique.mockResolvedValue({ ...activeSession, isActive: false });
      await expect(service.lookupForManualCheckIn('valid-token-abc', { bookingId: 'X' })).rejects.toThrow(GoneException);
    });
  });

  // ── listScannerSessions ───────────────────────────────────────────────────

  describe('listScannerSessions()', () => {
    const sessionListItem = { ...activeSession, token: 'tok-1', _count: { checkIns: 3 } };

    beforeEach(() => {
      prisma.event.findUnique.mockResolvedValue({ ...ownedEvent, hostProfile: { userId: hostUserId } });
      prisma.eventScannerSession.findMany.mockResolvedValue([sessionListItem]);
    });

    it('returns sessions with scannerUrl and checkInCount', async () => {
      const result = await service.listScannerSessions(hostUserId, eventId);
      expect(result).toHaveLength(1);
      expect(result[0].scannerUrl).toMatch(/\/scan\?token=tok-1$/);
      expect(result[0].checkInCount).toBe(3);
    });

    it('throws NotFoundException when event does not exist', async () => {
      prisma.event.findUnique.mockResolvedValue(null);
      await expect(service.listScannerSessions(hostUserId, eventId)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when user does not own the event', async () => {
      prisma.event.findUnique.mockResolvedValue({ ...ownedEvent, hostProfile: { userId: 'other' } });
      await expect(service.listScannerSessions(hostUserId, eventId)).rejects.toThrow(ForbiddenException);
    });
  });

  // ── getCheckInStats ───────────────────────────────────────────────────────

  describe('getCheckInStats()', () => {
    const sessionsWithCount = [
      { id: 'sess-1', staffName: 'Staff A', staffEmail: 'a@test.com', label: 'Gate A', isActive: true, expiresAt: new Date(), _count: { checkIns: 5 } },
    ];

    beforeEach(() => {
      prisma.event.findUnique.mockResolvedValue({ ...ownedEvent, hostProfile: { userId: hostUserId } });
      prisma.orderAttendee.count
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(42);
      prisma.eventScannerSession.findMany.mockResolvedValue(sessionsWithCount);
    });

    it('returns totalAttendees, checkedIn, remaining and per-session breakdown', async () => {
      const result = await service.getCheckInStats(hostUserId, eventId);
      expect(result.totalAttendees).toBe(100);
      expect(result.checkedIn).toBe(42);
      expect(result.remaining).toBe(58);
      expect(result.bySession[0].checkInCount).toBe(5);
    });

    it('throws NotFoundException when event does not exist', async () => {
      prisma.event.findUnique.mockResolvedValue(null);
      await expect(service.getCheckInStats(hostUserId, eventId)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when user does not own the event', async () => {
      prisma.event.findUnique.mockResolvedValue({ ...ownedEvent, hostProfile: { userId: 'other' } });
      await expect(service.getCheckInStats(hostUserId, eventId)).rejects.toThrow(ForbiddenException);
    });
  });

  // ── getScannerLiveStats ───────────────────────────────────────────────────

  describe('getScannerLiveStats()', () => {
    const activeSessionStub = { id: sessionId, eventId, isActive: true, expiresAt: new Date(Date.now() + 3600_000) };

    beforeEach(() => {
      prisma.eventScannerSession.findUnique.mockResolvedValue(activeSessionStub);
      prisma.orderAttendee.count
        .mockResolvedValueOnce(7)
        .mockResolvedValueOnce(93);
    });

    it('returns checkedInThisGate and totalRemaining', async () => {
      const result = await service.getScannerLiveStats('valid-token');
      expect(result).toEqual({ checkedInThisGate: 7, totalRemaining: 93 });
    });

    it('throws UnauthorizedException for an unknown token', async () => {
      prisma.eventScannerSession.findUnique.mockResolvedValue(null);
      await expect(service.getScannerLiveStats('bad-token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws GoneException when session is deactivated', async () => {
      prisma.eventScannerSession.findUnique.mockResolvedValue({ ...activeSessionStub, isActive: false });
      await expect(service.getScannerLiveStats('valid-token')).rejects.toThrow(GoneException);
    });

    it('throws GoneException when session is expired', async () => {
      prisma.eventScannerSession.findUnique.mockResolvedValue({ ...activeSessionStub, expiresAt: new Date(Date.now() - 1000) });
      await expect(service.getScannerLiveStats('valid-token')).rejects.toThrow(GoneException);
    });
  });

  // ── manualCheckIn ─────────────────────────────────────────────────────────

  describe('manualCheckIn()', () => {
    const dto = { attendeeId: 'att-uuid', scannerToken: 'valid-token-abc' };
    const attendeeRecord = {
      id: 'att-uuid',
      fullName: 'Riya Sen',
      isLead: true,
      checkedInAt: null,
      orderItem: {
        ticket: { name: 'General' },
        order: { eventId, status: 'CONFIRMED', event: { status: 'PUBLISHED' } },
      },
    };

    beforeEach(() => {
      prisma.eventScannerSession.findUnique.mockResolvedValue({
        id: sessionId, eventId, isActive: true, expiresAt: new Date(Date.now() + 3600_000),
      });
      prisma.orderAttendee.findUnique.mockResolvedValue(attendeeRecord);
      prisma.orderAttendee.update.mockResolvedValue({
        ...attendeeRecord,
        checkedInAt: new Date(),
        orderItem: { ...attendeeRecord.orderItem },
      });
    });

    it('checks in the attendee and returns alreadyCheckedIn false', async () => {
      const result = await service.manualCheckIn(dto);
      expect(result.alreadyCheckedIn).toBe(false);
      expect(prisma.orderAttendee.update).toHaveBeenCalled();
    });

    it('returns alreadyCheckedIn true for a duplicate check-in', async () => {
      prisma.orderAttendee.findUnique.mockResolvedValue({ ...attendeeRecord, checkedInAt: new Date() });
      const result = await service.manualCheckIn(dto);
      expect(result.alreadyCheckedIn).toBe(true);
      expect(prisma.orderAttendee.update).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException for an invalid scanner token', async () => {
      prisma.eventScannerSession.findUnique.mockResolvedValue(null);
      await expect(service.manualCheckIn(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('throws GoneException when session is deactivated', async () => {
      prisma.eventScannerSession.findUnique.mockResolvedValue({ id: sessionId, eventId, isActive: false, expiresAt: new Date(Date.now() + 3600_000) });
      await expect(service.manualCheckIn(dto)).rejects.toThrow(GoneException);
    });

    it('throws NotFoundException when attendee does not exist', async () => {
      prisma.orderAttendee.findUnique.mockResolvedValue(null);
      await expect(service.manualCheckIn(dto)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when attendee belongs to a different event', async () => {
      prisma.orderAttendee.findUnique.mockResolvedValue({
        ...attendeeRecord,
        orderItem: { ...attendeeRecord.orderItem, order: { ...attendeeRecord.orderItem.order, eventId: 'other-event' } },
      });
      await expect(service.manualCheckIn(dto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the event is cancelled', async () => {
      prisma.orderAttendee.findUnique.mockResolvedValue({
        ...attendeeRecord,
        orderItem: { ...attendeeRecord.orderItem, order: { ...attendeeRecord.orderItem.order, event: { status: 'CANCELLED' } } },
      });
      await expect(service.manualCheckIn(dto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the order is not confirmed', async () => {
      prisma.orderAttendee.findUnique.mockResolvedValue({
        ...attendeeRecord,
        orderItem: { ...attendeeRecord.orderItem, order: { ...attendeeRecord.orderItem.order, status: 'PENDING_PAYMENT' } },
      });
      await expect(service.manualCheckIn(dto)).rejects.toThrow(BadRequestException);
    });
  });

});
