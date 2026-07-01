import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsString, IsUUID, Min, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

class ValidateCouponItemDto {
  @ApiProperty({ example: 'ticket-tier-uuid' })
  @IsUUID('4')
  ticketId: string;

  @ApiProperty({ example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;
}

export class ValidateCouponDto {
  @ApiProperty({ example: 'event-uuid' })
  @IsUUID('4')
  eventId: string;

  @ApiProperty({ example: 'EARLYBIRD20' })
  @IsString()
  couponCode: string;

  @ApiProperty({ type: [ValidateCouponItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ValidateCouponItemDto)
  items: ValidateCouponItemDto[];
}
