import { ApiPropertyOptional } from '@nestjs/swagger';
import { FeedPostCategory } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdatePostDto {
  @ApiPropertyOptional({ description: 'Replacement post text.', maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  content?: string;

  @ApiPropertyOptional({ type: [String], description: 'Replacement set of S3 keys from COMMUNITY_FEED_MEDIA uploads (max 10).' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  mediaKeys?: string[];

  @ApiPropertyOptional({ enum: FeedPostCategory, description: 'Updated post category.' })
  @IsOptional()
  @IsEnum(FeedPostCategory)
  category?: FeedPostCategory;

  @ApiPropertyOptional({ description: 'Updated topic tag — powers Trending Topics.', maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  topic?: string;
}
