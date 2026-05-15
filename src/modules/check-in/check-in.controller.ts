import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { CheckInService } from './check-in.service';
import { ScanTicketDto } from './dto/scan-ticket.dto';
import { ManualCheckInDto } from './dto/manual-check-in.dto';

@ApiTags('Check-In')
@ApiBearerAuth('firebase-token')
@Controller('check-in')
export class CheckInController {
  constructor(private readonly checkInService: CheckInService) {}

  @Get('verify-session')
  @Public()
  @ApiOperation({
    summary: 'Validate scanner token and get event info',
    description: 'Called when the scanner page loads. Returns event details and session metadata.',
  })
  @ApiQuery({ name: 'token', type: String })
  verifySession(@Query('token') token: string) {
    return this.checkInService.verifySession(token);
  }

  @Get('live-stats')
  @Public()
  @ApiOperation({
    summary: 'Get live check-in summary for the scanner page',
    description: 'Returns how many attendees this gate has checked in and how many remain across the event. Poll this for the live summary card.',
  })
  @ApiQuery({ name: 'token', type: String })
  getScannerLiveStats(@Query('token') token: string) {
    return this.checkInService.getScannerLiveStats(token);
  }

  @Get('lookup')
  @Public()
  @ApiOperation({
    summary: 'Look up a booking for manual check-in',
    description:
      'Staff searches by booking ID (printed on ticket) or individual ticket code. Returns order-item level data for the manual check-in flow. Provide exactly one of bookingId or ticketCode.',
  })
  @ApiQuery({ name: 'token', type: String })
  @ApiQuery({ name: 'bookingId', required: false, type: String, description: 'Human-readable booking code printed on the ticket (e.g. MDAY-XXXX-XXXX)' })
  @ApiQuery({ name: 'ticketCode', required: false, type: String, description: 'Individual attendee ticket UUID (from QR code data)' })
  lookupForManualCheckIn(
    @Query('token') token: string,
    @Query('bookingId') bookingId?: string,
    @Query('ticketCode') ticketCode?: string,
  ) {
    return this.checkInService.lookupForManualCheckIn(token, { bookingId, ticketCode });
  }

  @Post('scan')
  @Public()
  @ApiOperation({ summary: 'Scan a ticket QR code and mark attendee as checked in' })
  scanTicket(@Body() dto: ScanTicketDto) {
    return this.checkInService.scanTicket(dto);
  }

  @Post('manual-check-in')
  @Public()
  @ApiOperation({
    summary: 'Manually check in an attendee by ID',
    description: 'Used after a booking lookup. Staff taps an attendee to check them in without scanning a QR code.',
  })
  manualCheckIn(@Body() dto: ManualCheckInDto) {
    return this.checkInService.manualCheckIn(dto);
  }
}
