import { IsArray, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SocialLinksDto } from '../../hosts/dto/apply-host.dto';
import { PastEventDto } from '../../hosts/dto/past-event.dto';
import { BrandWorkedWithDto } from '../../hosts/dto/brand-worked-with.dto';

// Admin creates the community space profile already-approved for a space partner who doesn't
// have one yet, bypassing the normal PENDING → admin-review flow (see ActivateSpaceCommunityDto
// for the space-partner-side equivalent, which always starts as PENDING).
export class CreateAdminSpaceCommunityProfileDto {
  @ApiProperty({ description: 'SpaceProfile UUID to create the community profile for' })
  @IsUUID()
  spaceProfileId: string;

  @ApiProperty({ example: 'WeWork Koramangala' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'A vibrant co-working space for founders and freelancers.' })
  @IsString()
  about: string;

  @ApiProperty({ description: 'GCS object key from POST /storage/upload-url (SPONSORSHIP_MEDIA context)' })
  @IsString()
  logoKey: string;

  @ApiPropertyOptional({ description: '"Highlight Poster" — GCS object key for the optional 4:5 asset' })
  @IsOptional()
  @IsString()
  posterKey?: string;

  @ApiProperty({ example: '3', description: 'Number of venues / event spaces at the location' })
  @IsString()
  numberOfVenues: string;

  @ApiProperty({ example: '80', description: 'Max capacity per venue' })
  @IsString()
  venueCapacity: string;

  @ApiProperty({ example: '250', description: 'Number of active members in the space' })
  @IsString()
  communitySize: string;

  @ApiProperty({ example: '40' })
  @IsString()
  experiencesPerYear: string;

  @ApiProperty({ type: [String], description: 'Space category UUIDs from GET /categories?type=SPACE' })
  @IsArray()
  @IsUUID('4', { each: true })
  categoryIds: string[];

  @ApiPropertyOptional({ type: [String], example: ['Koramangala, Bengaluru'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  activeLocations?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'GCS object keys for photographs of the centre (COMMUNITY_PAST_EVENT_MEDIA context)',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  centreShowcaseImageKeys?: string[];

  @ApiPropertyOptional({ example: 'https://youtube.com/watch?v=...' })
  @IsOptional()
  @IsString()
  videoLink?: string;

  // Written onto the space partner's own profile (not the community profile row) — same shape
  // as the space-partner-side socialLinks field.
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
