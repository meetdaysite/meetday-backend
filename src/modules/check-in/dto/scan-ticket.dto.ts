import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ScanTicketDto {
  @ApiProperty({ description: 'UUID from the attendee QR code' })
  @IsString()
  ticketCode: string;

  @ApiProperty({ description: '32-byte hex scanner session token' })
  @IsString()
  scannerToken: string;
}
