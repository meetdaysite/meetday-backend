import { IsArray, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PastEventDto } from '../../hosts/dto/past-event.dto';
import { BrandWorkedWithDto } from '../../hosts/dto/brand-worked-with.dto';

export class ActivateSpaceCommunityDto {
  @ApiProperty({ example: 'WeWork Koramangala' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'A vibrant co-working space for founders and freelancers.' })
  @IsString()
  about: string;

  @ApiProperty({ description: 'GCS object key from POST /storage/upload-url (SPONSORSHIP_MEDIA context)' })
  @IsString()
  logoKey: string;

  @ApiPropertyOptional({ description: '"Highlight Poster" — GCS object key for the 4:5 asset, or null to remove it' })
  @IsOptional()
  @IsString()
  posterKey?: string | null;

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

  @ApiProperty({ type: [String], description: 'Space category UUIDs from GET /categories?type=SPACE' })
  @IsArray()
  @IsUUID('4', { each: true })
  categoryIds: string[];

  @ApiPropertyOptional({ type: [PastEventDto], description: 'Optional showcase of past events — entirely optional.' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PastEventDto)
  pastEvents?: PastEventDto[];

  @ApiPropertyOptional({ type: [BrandWorkedWithDto], description: 'Optional showcase of brands worked with.' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BrandWorkedWithDto)
  brandsWorkedWith?: BrandWorkedWithDto[];
}
