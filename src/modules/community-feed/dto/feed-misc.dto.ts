import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FeedPostCategory } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class ListPostsQueryDto {
  @ApiPropertyOptional({
    description: 'ISO timestamp cursor — pass the `nextCursor` from the previous page to fetch older items. Omit for the first page.',
    example: '2026-06-24T09:15:00.000Z',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ description: 'Max items per page.', default: 20, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;

  @ApiPropertyOptional({ enum: FeedPostCategory })
  @IsOptional()
  @IsEnum(FeedPostCategory)
  category?: FeedPostCategory;

  @ApiPropertyOptional({ description: 'Filter by topic tag' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  topic?: string;
}

export class CreateCommentDto {
  @ApiProperty({ description: 'Comment text.', maxLength: 2000, example: 'Rooftop gets my vote 🙌' })
  @IsString()
  @MaxLength(2000)
  content: string;
}

export class ReactionDto {
  @ApiProperty({ description: 'The reaction emoji to add or remove.', example: '❤️', maxLength: 16 })
  @IsString()
  @MaxLength(16)
  emoji: string;
}

export class VotePollDto {
  @ApiProperty({ description: 'The poll option to vote for — one of the `poll.options[].id` values from the post.', format: 'uuid' })
  @IsUUID()
  optionId: string;
}

export class WindowQueryDto {
  @ApiPropertyOptional({ description: 'Look-back window in days.', default: 7, minimum: 1, maximum: 90 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  windowDays?: number = 7;

  @ApiPropertyOptional({ description: 'Max items to return.', default: 10, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;
}
