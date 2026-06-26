import { ApiPropertyOptional } from '@nestjs/swagger';
import { FeedPostType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const ADMIN_POST_STATUSES = ['PENDING', 'PUBLISHED', 'REPORTED', 'REJECTED', 'DELETED'] as const;
export type AdminPostStatusFilter = (typeof ADMIN_POST_STATUSES)[number];

export class AdminListPostsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;

  @ApiPropertyOptional({ enum: ADMIN_POST_STATUSES, description: 'REPORTED is a virtual filter (posts with ≥1 pending report). DELETED shows soft-deleted posts.' })
  @IsOptional()
  @IsIn(ADMIN_POST_STATUSES)
  status?: AdminPostStatusFilter;

  @ApiPropertyOptional({ enum: FeedPostType })
  @IsOptional()
  @IsEnum(FeedPostType)
  postType?: FeedPostType;

  @ApiPropertyOptional({ description: 'Filter by author UUID.' })
  @IsOptional()
  @IsUUID()
  authorId?: string;

  @ApiPropertyOptional({ description: 'Case-insensitive full-text search on post content.', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: ['newest', 'oldest', 'most_engaged'], default: 'newest' })
  @IsOptional()
  @IsIn(['newest', 'oldest', 'most_engaged'])
  sort?: 'newest' | 'oldest' | 'most_engaged' = 'newest';

  @ApiPropertyOptional({ description: 'ISO 8601 start date for createdAt range filter.' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 end date for createdAt range filter.' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
