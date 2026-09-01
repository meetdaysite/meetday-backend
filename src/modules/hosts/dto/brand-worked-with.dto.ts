import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

// Fully optional at every field — a host can add just a name, just a logo, or skip entirely.
export class BrandWorkedWithDto {
  @ApiPropertyOptional({ example: 'Nike' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  brandName?: string;

  @ApiPropertyOptional({ example: 'https://nike.com' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string;

  @ApiPropertyOptional({
    description: 'GCS object key from POST /storage/upload-url (COMMUNITY_BRAND_LOGO_MEDIA context)',
  })
  @IsOptional()
  @IsString()
  logoKey?: string;
}
