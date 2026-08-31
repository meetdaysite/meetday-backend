import { IsArray, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SocialLinksDto } from '../../hosts/dto/apply-host.dto';
import { PastEventDto } from '../../hosts/dto/past-event.dto';
import { BrandWorkedWithDto } from '../../hosts/dto/brand-worked-with.dto';

// Admin creates the community profile already-approved for a host who doesn't have one yet,
// bypassing the normal PENDING → admin-review flow (see ActivateCommunityDto for the host-side
// equivalent, which always starts as PENDING).
export class CreateAdminCommunityProfileDto {
  @ApiProperty({ description: 'HostProfile UUID to create the community profile for' })
  @IsUUID()
  hostProfileId: string;

  @ApiProperty({ example: 'Bangalore Founders Circle' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'A community of early-stage founders who meet monthly.' })
  @IsString()
  about: string;

  @ApiProperty({ description: 'GCS object key from POST /storage/upload-url (SPONSORSHIP_MEDIA context)' })
  @IsString()
  logoKey: string;

  @ApiPropertyOptional({ description: 'Optional GCS object key for the secondary 4:5 image' })
  @IsOptional()
  @IsString()
  secondaryImageKey?: string;

  @ApiProperty({ example: '250' })
  @IsString()
  size: string;


  @ApiProperty({ example: '60' })
  @IsString()
  avgGuestCount: string;

  @ApiProperty({ example: '12' })
  @IsString()
  experiencesPerYear: string;

  @ApiProperty({ type: [String], description: 'Category UUIDs from GET /categories' })
  @IsArray()
  @IsUUID('4', { each: true })
  categoryIds: string[];

  // Written onto the host's own profile (not the community profile row) — same shape as the
  // host-side ApplyHostDto/UpdateHostProfileDto socialLinks field.
  @ApiPropertyOptional({ type: SocialLinksDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SocialLinksDto)
  socialLinks?: SocialLinksDto;

  @ApiPropertyOptional({ type: [PastEventDto], description: 'Past events/experiences to showcase on the profile' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PastEventDto)
  pastEvents?: PastEventDto[];

  @ApiPropertyOptional({
    type: [BrandWorkedWithDto],
    description: 'Optional showcase of brands worked with',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BrandWorkedWithDto)
  brandsWorkedWith?: BrandWorkedWithDto[];
}
