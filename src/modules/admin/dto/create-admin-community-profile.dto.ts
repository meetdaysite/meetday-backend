import { IsArray, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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
}
