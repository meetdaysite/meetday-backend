import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export const EXPERIENCE_STATUS_FILTERS = ['ALL', 'UPCOMING', 'LIVE', 'COMPLETED', 'DRAFT', 'CANCELLED'] as const;
export type ExperienceStatusFilter = (typeof EXPERIENCE_STATUS_FILTERS)[number];

export const EXPERIENCE_SORTS = ['NEWEST_FIRST', 'OLDEST', 'MOST_BOOKINGS', 'REVENUE'] as const;
export type ExperienceSort = (typeof EXPERIENCE_SORTS)[number];

export class ListCommunityExperiencesQueryDto {
  @ApiPropertyOptional({ enum: EXPERIENCE_STATUS_FILTERS, default: 'ALL' })
  @IsOptional()
  @IsEnum(EXPERIENCE_STATUS_FILTERS)
  status?: ExperienceStatusFilter = 'ALL';

  @ApiPropertyOptional({ description: 'Search by experience title' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: EXPERIENCE_SORTS, default: 'NEWEST_FIRST' })
  @IsOptional()
  @IsEnum(EXPERIENCE_SORTS)
  sort?: ExperienceSort = 'NEWEST_FIRST';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;
}
