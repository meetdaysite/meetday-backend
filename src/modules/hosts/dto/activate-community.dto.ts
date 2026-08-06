import { IsArray, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ActivateCommunityDto {
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
