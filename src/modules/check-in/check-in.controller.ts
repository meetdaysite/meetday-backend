import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiGoneResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { CheckInService } from './check-in.service';
import { ScanTicketDto } from './dto/scan-ticket.dto';
import { ManualCheckInDto } from './dto/manual-check-in.dto';

@ApiTags('Check-In')
@Controller('check-in')
export class CheckInController {
  constructor(private readonly checkInService: CheckInService) {}

  @Get('verify-session')
  @Public()
  @ApiOperation({
    summary: 'Validate scanner token and get event info',
    description:
      'Called when the staff scanner page first loads. Validates the scanner token embedded in the ' +
      'staff link and returns the session metadata plus the event details to render in the scanner header. ' +
      '**Public endpoint** — no login required; the `token` query param is the credential. ' +
      'Call this before any scan/lookup to fail fast on a revoked or expired link.',
  })
  @ApiQuery({ name: 'token', type: String, description: '32-byte hex scanner session token from the staff link (?token=...)', example: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2' })
  @ApiOkResponse({
    description: 'Token is valid and active. Returns the session and its event.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-07-03T10:00:00.000Z',
        data: {
          sessionId: 'session-uuid',
          staffName: 'Rahul Sharma',
          label: 'Gate A',
          event: {
            id: 'event-uuid',
            title: 'Bangalore Open Mic — Stand Up Night',
            eventDate: '2026-07-12T00:00:00.000Z',
            startTime: '7:00 PM',
            endTime: '10:00 PM',
            venueName: 'The Comedy Theatre',
            city: 'Bengaluru',
          },
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Invalid scanner link — no session matches the token.' })
  @ApiGoneResponse({ description: 'Scanner link has been deactivated by the host, or has expired.' })
  verifySession(@Query('token') token: string) {
    return this.checkInService.verifySession(token);
  }

  @Get('live-stats')
  @Public()
  @ApiOperation({
    summary: 'Get live check-in summary for the scanner page',
    description:
      'Returns how many attendees **this gate** has checked in and how many remain across the whole event. ' +
      'Poll this to keep the scanner’s live summary card up to date. ' +
      '**Public endpoint** — the `token` query param is the credential.',
  })
  @ApiQuery({ name: 'token', type: String, description: '32-byte hex scanner session token', example: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2' })
  @ApiOkResponse({
    description: 'Live counts for this gate and the event.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-07-03T10:00:00.000Z',
        data: {
          checkedInThisGate: 42,
          totalRemaining: 118,
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Invalid scanner token.' })
  @ApiGoneResponse({ description: 'Scanner session has been deactivated or has expired.' })
  getScannerLiveStats(@Query('token') token: string) {
    return this.checkInService.getScannerLiveStats(token);
  }

  @Get('lookup')
  @Public()
  @ApiOperation({
    summary: 'Look up a booking for manual check-in',
    description:
      'Used when a QR code will not scan. Staff searches by the booking ID printed on the ticket, or by an ' +
      'individual ticket code, and gets back order-item level counts to drive the manual check-in screen. ' +
      'Provide **exactly one** of `bookingId` or `ticketCode`. ' +
      '**Public endpoint** — the `token` query param is the credential.',
  })
  @ApiQuery({ name: 'token', type: String, description: '32-byte hex scanner session token', example: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2' })
  @ApiQuery({ name: 'bookingId', required: false, type: String, description: 'Human-readable booking code printed on the ticket (e.g. MDAY-XXXX-XXXX)', example: 'MDAY-0381-1660' })
  @ApiQuery({ name: 'ticketCode', required: false, type: String, description: 'Individual attendee ticket UUID (from QR code data)', example: 'ticket-code-uuid' })
  @ApiOkResponse({
    description: 'Booking found for this event. Returns per-ticket-type entry counts.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-07-03T10:00:00.000Z',
        data: {
          bookingCode: 'MDAY-0381-1660',
          orderStatus: 'CONFIRMED',
          items: [
            { orderItemId: 'order-item-uuid', ticketType: 'Comedy Pass', totalEntries: 2, checkedInCount: 1 },
          ],
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Neither or both of bookingId/ticketCode were provided — supply exactly one.' })
  @ApiUnauthorizedResponse({ description: 'Invalid scanner token.' })
  @ApiGoneResponse({ description: 'Scanner session has been deactivated or has expired.' })
  @ApiNotFoundResponse({ description: 'No matching ticket, or booking not found for this event.' })
  lookupForManualCheckIn(
    @Query('token') token: string,
    @Query('bookingId') bookingId?: string,
    @Query('ticketCode') ticketCode?: string,
  ) {
    return this.checkInService.lookupForManualCheckIn(token, { bookingId, ticketCode });
  }

  @Post('scan')
  @Public()
  @ApiOperation({
    summary: 'Scan a ticket QR code and check the attendee in',
    description:
      'The primary scan action. Marks the attendee identified by the QR `ticketCode` as checked in and returns ' +
      'the booking’s group view (all entries on the same ticket and their check-in state). ' +
      'If the attendee was **already checked in**, responds `200` with `alreadyCheckedIn: true`, the original ' +
      'check-in time, and which gate did it — the client should show a warning rather than an error. ' +
      '**Public endpoint** — the `scannerToken` in the body is the credential.',
  })
  @ApiBody({
    type: ScanTicketDto,
    examples: {
      default: {
        summary: 'Scan a ticket',
        value: {
          ticketCode: 'ticket-code-uuid',
          scannerToken: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        },
      },
    },
  })
  @ApiOkResponse({
    description: 'Ticket resolved. `alreadyCheckedIn` distinguishes a fresh check-in from a duplicate scan.',
    schema: {
      examples: {
        checkedIn: {
          summary: 'Fresh check-in',
          value: {
            success: true,
            timestamp: '2026-07-03T10:00:00.000Z',
            data: {
              alreadyCheckedIn: false,
              checkedInAt: '2026-07-03T10:00:00.000Z',
              order: {
                bookingCode: 'MDAY-0381-1660',
                ticketType: 'Comedy Pass',
                totalEntries: 2,
                checkedInCount: 1,
                entries: [
                  { position: 1, isCheckedIn: true },
                  { position: 2, isCheckedIn: false },
                ],
              },
            },
          },
        },
        duplicate: {
          summary: 'Already checked in (duplicate scan)',
          value: {
            success: true,
            timestamp: '2026-07-03T10:05:00.000Z',
            data: {
              alreadyCheckedIn: true,
              checkedInAt: '2026-07-03T09:40:00.000Z',
              ticketCodeSuffix: 'a1b2',
              gateName: 'Gate A',
              order: {
                bookingCode: 'MDAY-0381-1660',
                ticketType: 'Comedy Pass',
                totalEntries: 2,
                checkedInCount: 2,
                entries: [
                  { position: 1, isCheckedIn: true },
                  { position: 2, isCheckedIn: true },
                ],
              },
            },
          },
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Ticket belongs to a different event, the event is cancelled, or the order is not confirmed.' })
  @ApiUnauthorizedResponse({ description: 'Invalid scanner token.' })
  @ApiGoneResponse({ description: 'Scanner session has been deactivated or has expired.' })
  @ApiNotFoundResponse({ description: 'No ticket matches the provided ticketCode.' })
  scanTicket(@Body() dto: ScanTicketDto) {
    return this.checkInService.scanTicket(dto);
  }

  @Post('manual-check-in')
  @Public()
  @ApiOperation({
    summary: 'Manually check in an attendee by ID',
    description:
      'Used after a booking lookup when the QR code cannot be scanned. Staff taps a specific attendee to check ' +
      'them in by `attendeeId`. Like `/scan`, a re-tap on an already checked-in attendee returns `200` with ' +
      '`alreadyCheckedIn: true` rather than an error. ' +
      '**Public endpoint** — the `scannerToken` in the body is the credential.',
  })
  @ApiBody({
    type: ManualCheckInDto,
    examples: {
      default: {
        summary: 'Check in an attendee',
        value: {
          attendeeId: 'attendee-uuid',
          scannerToken: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        },
      },
    },
  })
  @ApiOkResponse({
    description: 'Attendee resolved. `alreadyCheckedIn` distinguishes a fresh check-in from a repeat tap.',
    schema: {
      examples: {
        checkedIn: {
          summary: 'Fresh check-in',
          value: {
            success: true,
            timestamp: '2026-07-03T10:00:00.000Z',
            data: {
              alreadyCheckedIn: false,
              checkedInAt: '2026-07-03T10:00:00.000Z',
              attendee: { fullName: 'Aanya Kapoor', ticketName: 'Comedy Pass', isLead: true },
            },
          },
        },
        duplicate: {
          summary: 'Already checked in',
          value: {
            success: true,
            timestamp: '2026-07-03T10:05:00.000Z',
            data: {
              alreadyCheckedIn: true,
              checkedInAt: '2026-07-03T09:40:00.000Z',
              attendee: { fullName: 'Aanya Kapoor', ticketName: 'Comedy Pass', isLead: true },
            },
          },
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Attendee belongs to a different event, the event is cancelled, or the order is not confirmed.' })
  @ApiUnauthorizedResponse({ description: 'Invalid scanner token.' })
  @ApiGoneResponse({ description: 'Scanner session has been deactivated or has expired.' })
  @ApiNotFoundResponse({ description: 'No attendee matches the provided attendeeId.' })
  manualCheckIn(@Body() dto: ManualCheckInDto) {
    return this.checkInService.manualCheckIn(dto);
  }
}
