import { IsArray, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PastEventDto } from './past-event.dto';

export class ActivateCommunityDto {
  @ApiProperty({ description: 'Optional GCS object key for the secondary 4:5 image' })
  @IsString()
  @IsOptional()
  secondaryImageKey?: string;
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

  @ApiPropertyOptional({
    type: [PastEventDto],
    description: 'Optional showcase of past events — entirely optional, and every field within each entry is optional too.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PastEventDto)
  pastEvents?: PastEventDto[];
}
