import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  Max,
  ArrayMaxSize,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateReviewDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({ description: 'Rating for the host (1–5)', minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  hostRating?: number;

  @ApiPropertyOptional({ description: 'Written review for the host', maxLength: 800 })
  @IsOptional()
  @IsString()
  @MaxLength(800)
  hostBody?: string;

  @ApiPropertyOptional({ type: [String], description: 'Highlight keys for this event category' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  highlights?: string[];

  @ApiPropertyOptional({ maxLength: 800 })
  @IsOptional()
  @IsString()
  @MaxLength(800)
  body?: string;

  @ApiPropertyOptional({ type: [String], description: 'Replaces all existing photos. S3 keys, max 10.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  photoKeys?: string[];
}
