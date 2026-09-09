import { IsArray, IsBoolean, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SocialLinksDto } from '../../hosts/dto/apply-host.dto';
import { PastEventDto } from '../../hosts/dto/past-event.dto';
import { BrandWorkedWithDto } from '../../hosts/dto/brand-worked-with.dto';

// Full admin edit of an existing community space profile — every field optional, only the
// fields provided are updated. Writes directly (no pendingRevision staging) and works
// regardless of the profile's current approvalStatus.
export class UpdateAdminSpaceCommunityProfileDto {
  @ApiPropertyOptional({ example: 'WeWork Koramangala' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'A vibrant co-working space for founders and freelancers.' })
  @IsOptional()
  @IsString()
  about?: string;

  @ApiPropertyOptional({ description: 'GCS object key from POST /storage/upload-url (SPONSORSHIP_MEDIA context)' })
  @IsOptional()
  @IsString()
  logoKey?: string;

  @ApiPropertyOptional({ description: '"Highlight Poster" GCS object key — pass an empty string to clear it' })
  @IsOptional()
  @IsString()
  posterKey?: string;

  @ApiPropertyOptional({ example: '3' })
  @IsOptional()
  @IsString()
  numberOfVenues?: string;

  @ApiPropertyOptional({ example: '80' })
  @IsOptional()
  @IsString()
  venueCapacity?: string;

  @ApiPropertyOptional({ example: '250' })
  @IsOptional()
  @IsString()
  communitySize?: string;

  @ApiPropertyOptional({ example: '40' })
  @IsOptional()
  @IsString()
  experiencesPerYear?: string;

  @ApiPropertyOptional({ type: [String], description: 'Space category UUIDs from GET /categories?type=SPACE' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  categoryIds?: string[];

  @ApiPropertyOptional({ type: [String], example: ['Koramangala, Bengaluru'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  activeLocations?: string[];

  @ApiPropertyOptional({ type: [String], description: 'GCS object keys for photographs of the centre' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  centreShowcaseImageKeys?: string[];

  @ApiPropertyOptional({ example: 'https://youtube.com/watch?v=...' })
  @IsOptional()
  @IsString()
  videoLink?: string;

  @ApiPropertyOptional({ description: 'Hide (true) or unhide (false) this space from brand/community browse — does not affect the partner\'s own access.' })
  @IsOptional()
  @IsBoolean()
  isHidden?: boolean;

  // Written onto the space partner's own profile (not the community profile row).
  @ApiPropertyOptional({ type: SocialLinksDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SocialLinksDto)
  socialLinks?: SocialLinksDto;

  // Written onto the space partner's own profile (SpaceProfile.operatingCities).
  @ApiPropertyOptional({ type: [String], example: ['Mumbai', 'Pune'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  operatingCities?: string[];

  @ApiPropertyOptional({ type: [PastEventDto], description: 'Past events/experiences to showcase on the profile' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PastEventDto)
  pastEvents?: PastEventDto[];

  @ApiPropertyOptional({ type: [BrandWorkedWithDto], description: 'Optional showcase of brands worked with' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BrandWorkedWithDto)
  brandsWorkedWith?: BrandWorkedWithDto[];
}
