import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsUUID, Min, ValidateNested } from 'class-validator';

export class CancelTicketItemDto {
  @ApiProperty({ description: 'UUID of the OrderItem (ticket tier) to cancel from' })
  @IsUUID()
  orderItemId: string;

  @ApiProperty({ description: 'Number of seats to cancel for this ticket tier', minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiProperty({
    description: 'UUIDs of the specific OrderAttendee records to cancel. Length must equal quantity.',
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('all', { each: true })
  attendeeIds: string[];
}

export class CancelTicketsDto {
  @ApiProperty({ type: [CancelTicketItemDto], description: 'One entry per ticket tier being partially or fully cancelled.' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CancelTicketItemDto)
  items: CancelTicketItemDto[];
}
