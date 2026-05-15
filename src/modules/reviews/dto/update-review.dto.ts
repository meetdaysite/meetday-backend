import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  Max,
  ArrayMaxSize,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { REVIEW_HIGHLIGHTS } from './create-review.dto';

export class UpdateReviewDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({ type: [String], enum: REVIEW_HIGHLIGHTS })
  @IsOptional()
  @IsArray()
  @IsIn(REVIEW_HIGHLIGHTS, { each: true })
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
