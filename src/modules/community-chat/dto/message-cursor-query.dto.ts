import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';

export class MessageCursorQueryDto {
  @ApiPropertyOptional({
    description: 'ISO timestamp — fetch messages with createdAt before this value',
    example: '2026-06-23T10:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  cursor?: string;

  @ApiPropertyOptional({ default: 30, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 30;
}
