import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { CheckInService } from './check-in.service';
import { ScanTicketDto } from './dto/scan-ticket.dto';

@ApiTags('Check-In')
@ApiBearerAuth('firebase-token')
@Controller('check-in')
export class CheckInController {
  constructor(private readonly checkInService: CheckInService) {}

  @Get('verify-session')
  @Public()
  @ApiOperation({ summary: 'Validate a scanner token and get event info (called when scanner page loads)' })
  @ApiQuery({ name: 'token', type: String })
  verifySession(@Query('token') token: string) {
    return this.checkInService.verifySession(token);
  }

  @Post('scan')
  @Public()
  @ApiOperation({ summary: 'Scan a ticket QR code and mark attendee as checked in' })
  scanTicket(@Body() dto: ScanTicketDto) {
    return this.checkInService.scanTicket(dto);
  }
}
