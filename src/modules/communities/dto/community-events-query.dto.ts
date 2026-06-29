import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CommunityEventsQueryDto {
  @ApiPropertyOptional({
    description: 'When true, returns only events with eventDate >= now and status PUBLISHED.',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  upcoming?: boolean;

  @ApiPropertyOptional({
    enum: ['this_week', 'this_month', 'next_month'],
    description: 'Preset date range. Omit for All (no date restriction).',
  })
  @IsOptional()
  @IsEnum(['this_week', 'this_month', 'next_month'])
  dateFilter?: 'this_week' | 'this_month' | 'next_month';

  @ApiPropertyOptional({
    description: 'Filter by experience type (e.g. Rooftop, Club, Live, Festival). Case-insensitive.',
    example: 'Rooftop',
  })
  @IsOptional()
  @IsString()
  eventType?: string;

  @ApiPropertyOptional({
    description: "Filter by a genre tag present in the event's tags array.",
    example: 'EDM',
  })
  @IsOptional()
  @IsString()
  genre?: string;

  @ApiPropertyOptional({ enum: ['date', 'price'], default: 'date' })
  @IsOptional()
  @IsEnum(['date', 'price'])
  sortBy?: 'date' | 'price';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
