import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { MediaType, RefundTo, RefundType, Visibility } from '@prisma/client';

export class CreateEventMediaDto {
  @ApiPropertyOptional({ example: 'events/event-uuid/cover/abc123.jpg' })
  @IsString()
  key: string;

  @ApiPropertyOptional({ enum: MediaType, example: 'COVER' })
  @IsEnum(MediaType)
  type: MediaType;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number = 0;
}

export class CreateEventTicketDto {
  @ApiPropertyOptional({ example: 'General Admission', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 499, description: 'Price in INR. Must be 0 when isFree is true.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({ example: true, description: 'Mark this ticket tier as free. No platform fee is charged on free tickets.' })
  @IsOptional()
  @IsBoolean()
  isFree?: boolean;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  totalCapacity?: number;

  @ApiPropertyOptional({ example: 2, description: 'Max tickets per person' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxPerPerson?: number;

  @ApiPropertyOptional({ example: 'Includes welcome drink', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ example: '2026-06-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  saleStartDate?: string;

  @ApiPropertyOptional({ example: '2026-06-14T23:59:59.000Z' })
  @IsOptional()
  @IsDateString()
  saleEndDate?: string;
}

export class CreateEventRefundPolicyDto {
  @ApiPropertyOptional({ enum: RefundType, example: RefundType.PARTIAL })
  @IsOptional()
  @IsEnum(RefundType)
  type?: RefundType;

  @ApiPropertyOptional({
    example: 24,
    description: 'Hours before event after which no refund. Required when type is PARTIAL.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  cutoffHours?: number;

  @ApiPropertyOptional({
    example: 80,
    description: 'Percentage refunded (1–99). Required when type is PARTIAL.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99)
  refundPercent?: number;

  @ApiPropertyOptional({ enum: RefundTo, example: RefundTo.ORIGINAL_PAYMENT })
  @IsOptional()
  @IsEnum(RefundTo)
  refundTo?: RefundTo;
}

export class CreateEventDto {
  @ApiPropertyOptional({ example: 'uuid-of-category' })
  @IsOptional()
  @IsUUID('4')
  categoryId?: string;

  @ApiPropertyOptional({ example: 'Photography Walk in Bandra', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ example: 'Join us for a curated photography walk...' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'Workshop', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  eventType?: string;

  @ApiPropertyOptional({ type: [String], example: ['English', 'Hindi'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  languages?: string[];

  @ApiPropertyOptional({ type: [String], example: ['photography', 'mumbai'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ example: '2026-06-15T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  eventDate?: string;

  @ApiPropertyOptional({ example: '10:00 AM', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  startTime?: string;

  @ApiPropertyOptional({ example: '01:00 PM', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  endTime?: string;

  @ApiPropertyOptional({ example: 'Carter Road Promenade', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  venueName?: string;

  @ApiPropertyOptional({ example: 'Carter Road, Bandra West, Mumbai', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  fullAddress?: string;

  @ApiPropertyOptional({ example: 'Mumbai' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 19.0596 })
  @IsOptional()
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional({ example: 72.8295 })
  @IsOptional()
  @IsNumber()
  longitude?: number;

  @ApiPropertyOptional({ type: [String], example: ['Guided walk', 'Tips on street photography'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  whatToExpect?: string[];

  @ApiPropertyOptional({ type: [String], example: ['Photography enthusiasts', 'Beginners welcome'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  whoShouldAttend?: string[];

  @ApiPropertyOptional({ enum: Visibility, default: Visibility.PUBLIC })
  @IsOptional()
  @IsEnum(Visibility)
  visibility?: Visibility;

  @ApiPropertyOptional({ example: '18+' })
  @IsOptional()
  @IsString()
  ageRestriction?: string;

  @ApiPropertyOptional({ example: 'Bring a DSLR or mirrorless camera.' })
  @IsOptional()
  @IsString()
  specialInstructions?: string;

  @ApiPropertyOptional({ example: false, description: 'Mark true if this is a free event.' })
  @IsOptional()
  @IsBoolean()
  isFree?: boolean;

  @ApiPropertyOptional({ type: [CreateEventTicketDto], description: 'Replaces all existing tickets when provided.' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateEventTicketDto)
  tickets?: CreateEventTicketDto[];

  @ApiPropertyOptional({ type: CreateEventRefundPolicyDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateEventRefundPolicyDto)
  refundPolicy?: CreateEventRefundPolicyDto;

  @ApiPropertyOptional({ type: [CreateEventMediaDto], description: 'Replaces all existing media when provided.' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateEventMediaDto)
  media?: CreateEventMediaDto[];
}
