import {
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AdminSponsorTierDto } from './create-admin-sponsorship.dto';

// Full admin edit of an existing proposal — every field optional, only the fields provided
// are updated. Unlike the host-side edit flow, this writes directly (no pendingRevision
// staging) and works regardless of the proposal's current status.
export class UpdateAdminSponsorshipDto {
  @ApiPropertyOptional({ description: 'Reassign the proposal to a different existing host' })
  @IsOptional()
  @IsUUID()
  hostProfileId?: string;

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

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  venues?: string[];

  @ApiPropertyOptional({ type: [String] })
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

  @ApiPropertyOptional({ type: [AdminSponsorTierDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AdminSponsorTierDto)
  sponsorTiers?: AdminSponsorTierDto[];
}
