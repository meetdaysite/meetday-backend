import {
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SponsorTierDto {
  @ApiPropertyOptional({ example: 'Gold Sponsor' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: '50000' })
  @IsString()
  price: string;
}

// All fields optional — hosts save partial data at any step, same as CreateEventDto.
// Completeness is validated at submit time (see SponsorshipService.submitProposal).
export class CreateProposalDto {
  @ApiPropertyOptional({ example: 'Sunset Music Festival' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  about?: string;

  @ApiPropertyOptional({ description: 'GCS object key from POST /storage/upload-url (SPONSORSHIP_MEDIA context)' })
  @IsOptional()
  @IsString()
  imageKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  eventDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  eventEndDate?: string;

  @ApiPropertyOptional({ type: [String], description: 'Multiple venues for this sponsorship' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  venues?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Per-venue city, index-matched with `venues`' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  venueCities?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  audienceProfile?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ageGroup?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  guestCount?: string;

  @ApiPropertyOptional({ description: 'GCS object key from POST /storage/upload-url (SPONSORSHIP_DOCUMENT context)' })
  @IsOptional()
  @IsString()
  docKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  docName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  docType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  docSize?: number;

  @ApiPropertyOptional({ type: [SponsorTierDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SponsorTierDto)
  sponsorTiers?: SponsorTierDto[];
}
