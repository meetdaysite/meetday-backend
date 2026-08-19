import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

// Fully optional at every field — a host can add just images, just a name, or skip entirely.
export class PastEventDto {
  @ApiPropertyOptional({ example: 'Founders Meetup — March 2026' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ example: 'A relaxed evening of networking and lightning talks.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Up to 2 GCS object keys from POST /storage/upload-url (COMMUNITY_PAST_EVENT_MEDIA context)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @IsString({ each: true })
  imageKeys?: string[];
}
