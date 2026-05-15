import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OrderAttendeeDto {
  @ApiProperty({ example: 'Rahul Sharma' })
  @IsString()
  fullName: string;

  @ApiProperty({ example: 'rahul@example.com' })
  @IsEmail()
  email: string;
}

export class OrderItemDto {
  @ApiProperty({ example: 'ticket-tier-uuid' })
  @IsUUID('4')
  ticketId: string;

  @ApiProperty({ example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional({
    type: [OrderAttendeeDto],
    description:
      'Required when quantity > 1. Provide details for each additional attendee ' +
      '(must have exactly quantity - 1 entries). The buyer is automatically included as lead attendee.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderAttendeeDto)
  groupAttendees?: OrderAttendeeDto[];
}

export class CreateOrderDto {
  @ApiProperty({ example: 'event-uuid' })
  @IsUUID('4')
  eventId: string;

  @ApiProperty({ type: [OrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @ApiPropertyOptional({ example: 'EARLYBIRD20', description: 'Admin-issued attendee promo code.' })
  @IsOptional()
  @IsString()
  couponCode?: string;
}
