import { IsEnum, IsISO8601, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus } from '@prisma/client';

export class ListOrdersQueryDto {
  @ApiPropertyOptional({ description: 'Filter by event UUID' })
  @IsOptional()
  @IsUUID('4')
  eventId?: string;

  @ApiPropertyOptional({ description: 'Filter by user (attendee) UUID' })
  @IsOptional()
  @IsUUID('4')
  userId?: string;

  @ApiPropertyOptional({ description: 'Filter by host profile UUID' })
  @IsOptional()
  @IsUUID('4')
  hostProfileId?: string;

  @ApiPropertyOptional({ enum: OrderStatus, description: 'Filter by order status' })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @ApiPropertyOptional({ description: 'Filter by booking ID (e.g. MDAY-AB12-CD34)' })
  @IsOptional()
  @IsString()
  bookingId?: string;

  @ApiPropertyOptional({ description: 'Created at or after this ISO 8601 date', example: '2026-01-01' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Created at or before this ISO 8601 date', example: '2026-12-31' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
