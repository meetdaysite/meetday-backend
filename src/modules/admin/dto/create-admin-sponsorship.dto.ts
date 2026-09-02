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
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AdminSponsorTierDto {
  @ApiProperty({ example: 'Gold Sponsor' })
  @IsString()
  name: string;

  @ApiProperty({ example: '50000' })
  @IsString()
  price: string;
}

// Admin creates the proposal already-complete and published, unlike CreateProposalDto
// (host draft flow) where every field is optional — so everything here is required.
export class CreateAdminSponsorshipDto {
  @ApiPropertyOptional({
    description:
      'Attribute the proposal to a specific existing host instead of the "Meetday Official" system host. ' +
      'Omit to publish under Meetday Official as before.',
  })
  @IsOptional()
  @IsUUID()
  hostProfileId?: string;

  @ApiProperty({ example: 'Sunset Music Festival' })
  @IsString()
  name: string;

  @ApiProperty()
  @IsString()
  about: string;

  @ApiProperty({ description: 'GCS object key from POST /storage/upload-url (SPONSORSHIP_MEDIA context)' })
  @IsString()
  imageKey: string;

  @ApiProperty()
  @IsDateString()
  eventDate: string;

  @ApiProperty()
  @IsDateString()
  eventEndDate: string;

  @ApiProperty({ type: [String], description: 'Multiple venues for this sponsorship' })
  @IsArray()
  @IsString({ each: true })
  venues: string[];

  @ApiProperty({ type: [String], description: 'Per-venue city, index-matched with `venues`' })
  @IsArray()
  @IsString({ each: true })
  venueCities: string[];

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  audienceProfile: string[];

  @ApiProperty()
  @IsString()
  ageGroup: string;

  @ApiProperty()
  @IsString()
  guestCount: string;

  @ApiProperty({ description: 'GCS object key from POST /storage/upload-url (SPONSORSHIP_DOCUMENT context)' })
  @IsString()
  docKey: string;

  @ApiProperty()
  @IsString()
  docName: string;

  @ApiProperty()
  @IsString()
  docType: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  docSize: number;

  @ApiProperty({ type: [AdminSponsorTierDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AdminSponsorTierDto)
  sponsorTiers: AdminSponsorTierDto[];

  @ApiPropertyOptional({ enum: ['CASH', 'BARTER', 'BOTH'], default: 'CASH' })
  @IsOptional()
  @IsString()
  sponsorshipType?: string;
}
