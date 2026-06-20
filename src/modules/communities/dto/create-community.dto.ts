import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CommunityType } from '@prisma/client';

export class CreateCommunityDto {
  @ApiProperty({ example: 'Meetday Music Nights', maxLength: 120 })
  @IsString()
  @MaxLength(120)
  name: string;

  @ApiProperty({
    example: 'meetday-music-nights',
    description: 'Lowercase letters, numbers and hyphens only. Used in the community URL.',
  })
  @IsString()
  @MaxLength(140)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must contain lowercase letters, numbers and hyphens only',
  })
  slug: string;

  @ApiProperty({ enum: CommunityType, example: CommunityType.MEETDAY_MANAGED_PUBLIC })
  @IsEnum(CommunityType)
  type: CommunityType;

  @ApiPropertyOptional({ example: 'A public community for music lovers...', maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiPropertyOptional({ description: 'Category UUID' })
  @IsOptional()
  @IsUUID('4')
  categoryId?: string;

  @ApiPropertyOptional({ example: 'Kolkata' })
  @IsOptional()
  @IsString()
  primaryCity?: string;

  @ApiPropertyOptional({ description: 'S3 key for the cover image' })
  @IsOptional()
  @IsString()
  coverImageKey?: string;

  @ApiPropertyOptional({ description: 'S3 key for the community icon' })
  @IsOptional()
  @IsString()
  iconKey?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['Music', 'Electronic', 'Nightlife', 'Rooftops'],
    description: 'Free-form descriptive interest tags shown on the community (Step 1).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  interestTags?: string[];
}
