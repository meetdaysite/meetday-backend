import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CommunityAccess, CommunityType, MemberVisibility } from '@prisma/client';

/**
 * Partial update for top-level community fields. Powers per-step "Save Draft"
 * across the wizard (Basic Details + the Community Rules access/visibility +
 * Experience Mapping toggle live here).
 */
export class UpdateCommunityDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ description: 'Lowercase letters, numbers and hyphens only.' })
  @IsOptional()
  @IsString()
  @MaxLength(140)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must contain lowercase letters, numbers and hyphens only',
  })
  slug?: string;

  @ApiPropertyOptional({ enum: CommunityType })
  @IsOptional()
  @IsEnum(CommunityType)
  type?: CommunityType;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiPropertyOptional({ description: 'Category UUID' })
  @IsOptional()
  @IsUUID('4')
  categoryId?: string;

  @ApiPropertyOptional({ enum: CommunityAccess })
  @IsOptional()
  @IsEnum(CommunityAccess)
  access?: CommunityAccess;

  @ApiPropertyOptional({ enum: MemberVisibility })
  @IsOptional()
  @IsEnum(MemberVisibility)
  memberVisibility?: MemberVisibility;

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
    description: 'Free-form descriptive interest tags (Step 1). Replaces the full set when provided.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  interestTags?: string[];

  @ApiPropertyOptional({ description: 'Auto-attach matching events on resync/publish' })
  @IsOptional()
  @IsBoolean()
  autoAddMatchingEvents?: boolean;
}
