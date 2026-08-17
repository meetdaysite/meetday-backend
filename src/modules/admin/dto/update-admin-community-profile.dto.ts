import { IsArray, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SocialLinksDto } from '../../hosts/dto/apply-host.dto';

// Full admin edit of an existing community profile — every field optional, only the fields
// provided are updated. Writes directly (no pendingRevision staging) and works regardless of
// the profile's current approvalStatus. Also allows setting the secondaryImageKey (poster/
// banner), which the admin-create flow doesn't currently collect but the host-side one does.
export class UpdateAdminCommunityProfileDto {
  @ApiPropertyOptional({ example: 'Bangalore Founders Circle' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'A community of early-stage founders who meet monthly.' })
  @IsOptional()
  @IsString()
  about?: string;

  @ApiPropertyOptional({ description: 'GCS object key from POST /storage/upload-url (SPONSORSHIP_MEDIA context)' })
  @IsOptional()
  @IsString()
  logoKey?: string;

  @ApiPropertyOptional({ description: 'GCS object key for the secondary 4:5 image — pass an empty string to clear it' })
  @IsOptional()
  @IsString()
  secondaryImageKey?: string;

  @ApiPropertyOptional({ example: '250' })
  @IsOptional()
  @IsString()
  size?: string;

  @ApiPropertyOptional({ example: '60' })
  @IsOptional()
  @IsString()
  avgGuestCount?: string;

  @ApiPropertyOptional({ example: '12' })
  @IsOptional()
  @IsString()
  experiencesPerYear?: string;

  @ApiPropertyOptional({ type: [String], description: 'Category UUIDs from GET /categories' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  categoryIds?: string[];

  // Written onto the host's own profile (not the community profile row) — same shape as the
  // host-side ApplyHostDto/UpdateHostProfileDto socialLinks field.
  @ApiPropertyOptional({ type: SocialLinksDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SocialLinksDto)
  socialLinks?: SocialLinksDto;
}
