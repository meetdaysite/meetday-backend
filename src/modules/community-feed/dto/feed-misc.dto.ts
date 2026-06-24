import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FeedPostCategory } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class ListPostsQueryDto {
  @ApiPropertyOptional({ description: 'ISO timestamp cursor — posts created before this' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: 20, maximum: 50 })
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
  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  content: string;
}

export class ReactionDto {
  @ApiProperty({ example: '❤️' })
  @IsString()
  @MaxLength(16)
  emoji: string;
}

export class VotePollDto {
  @ApiProperty({ description: 'The poll option to vote for' })
  @IsUUID()
  optionId: string;
}

export class WindowQueryDto {
  @ApiPropertyOptional({ default: 7, description: 'Window in days' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  windowDays?: number = 7;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;
}
