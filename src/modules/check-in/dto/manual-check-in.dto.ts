import { IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ManualCheckInDto {
  @ApiProperty({ description: 'ID of the attendee to check in', format: 'uuid' })
  @IsUUID()
  attendeeId: string;

  @ApiProperty({ description: 'Scanner session token from the staff link' })
  @IsString()
  scannerToken: string;
}
