import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  Max,
  ArrayMaxSize,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const REVIEW_HIGHLIGHTS = [
  'GREAT_MUSIC',
  'GOOD_CROWD',
  'NICE_VENUE',
  'HELPFUL_HOST',
  'SMOOTH_ENTRY',
  'FELT_SAFE',
] as const;

export type ReviewHighlight = (typeof REVIEW_HIGHLIGHTS)[number];

export class CreateReviewDto {
  @ApiProperty()
  @IsUUID('4')
  eventId: string;

  @ApiProperty({ description: 'ID of the confirmed order for this event' })
  @IsUUID('4')
  orderId: string;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

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

  @ApiPropertyOptional({ type: [String], description: 'S3 keys of uploaded photos (max 10)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  photoKeys?: string[];
}
