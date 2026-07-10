import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddCommunityEventDto {
  @ApiProperty({ description: 'Event UUID to always attach to this community (manual mapping).' })
  @IsUUID('4')
  eventId: string;
}
