import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FeedPostCategory, FeedPostType } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class CreatePostDto {
  @ApiPropertyOptional({ enum: FeedPostType, default: FeedPostType.TEXT })
  @IsOptional()
  @IsEnum(FeedPostType)
  postType?: FeedPostType;

  @ApiPropertyOptional({ enum: FeedPostCategory, default: FeedPostCategory.GENERAL })
  @IsOptional()
  @IsEnum(FeedPostCategory)
  category?: FeedPostCategory;

  @ApiPropertyOptional({ description: 'Post text (or the poll question for POLL posts)' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  content?: string;

  @ApiPropertyOptional({ type: [String], description: 'S3 keys from COMMUNITY_FEED_MEDIA uploads' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  mediaKeys?: string[];

  @ApiPropertyOptional({ description: 'Freeform topic tag (often an event name) — powers Trending Topics' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  topic?: string;

  @ApiPropertyOptional({ description: 'Optional linked event id' })
  @IsOptional()
  @IsUUID()
  eventId?: string;

  @ApiPropertyOptional({ type: [String], description: 'Poll options (required when postType=POLL)' })
  @ValidateIf((o) => o.postType === FeedPostType.POLL)
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  pollOptions?: string[];
}
