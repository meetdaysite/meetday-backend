import { IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SocialStyle, VibeType } from '@prisma/client';

export class BrowseEventsQueryDto {
  @ApiPropertyOptional({ example: 'Mumbai' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'cat-uuid' })
  @IsOptional()
  @IsUUID('4')
  categoryId?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Filter by interest slugs (e.g. founders-huddle). Resolves to event categories via the InterestCategory mapping.',
    example: ['founders-huddle', 'ai-future-tech'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  interestSlugs?: string[];

  @ApiPropertyOptional({ example: true, description: 'Filter to free events only.' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isFree?: boolean;

  @ApiPropertyOptional({ example: '2026-06-01T00:00:00.000Z', description: 'Filter events on or after this date. Defaults to now if not set.' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-06-30T23:59:59.000Z', description: 'Filter events on or before this date.' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ example: 'photography', description: 'Search in event title.' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ['date', 'price'], default: 'date', description: 'Sort field.' })
  @IsOptional()
  @IsEnum(['date', 'price'])
  sortBy?: 'date' | 'price';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc', description: 'Sort direction.' })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @ApiPropertyOptional({ enum: VibeType, description: 'Reserved for future AI ranking — no effect on results currently.' })
  @IsOptional()
  @IsEnum(VibeType)
  vibeType?: VibeType;

  @ApiPropertyOptional({ enum: SocialStyle, description: 'Reserved for future AI ranking — no effect on results currently.' })
  @IsOptional()
  @IsEnum(SocialStyle)
  socialStyle?: SocialStyle;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}
