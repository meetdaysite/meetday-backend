import { ApiPropertyOptional } from '@nestjs/swagger';
import { FeedPostCategory } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdatePostDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  content?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  mediaKeys?: string[];

  @ApiPropertyOptional({ enum: FeedPostCategory })
  @IsOptional()
  @IsEnum(FeedPostCategory)
  category?: FeedPostCategory;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  topic?: string;
}
