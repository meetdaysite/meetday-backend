import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListAnnouncementsQueryDto {
  @ApiPropertyOptional({
    description: 'ISO timestamp — fetch announcements with publishedAt before this value',
    example: '2026-06-23T10:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  cursor?: string;

  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}
