import {
  IsArray,
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

  @ApiPropertyOptional({ type: [String], description: 'Highlight keys for this event category (fetch valid keys from GET /reviews/highlights?eventId=)' })
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

  @ApiPropertyOptional({ type: [String], description: 'S3 keys of uploaded photos (max 10)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  photoKeys?: string[];
}
