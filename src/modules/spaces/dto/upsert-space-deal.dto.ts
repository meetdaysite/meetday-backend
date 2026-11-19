import { IsISO8601, IsEnum, IsNumber, IsOptional, IsString, Min, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpsertSpaceDealDto {
  @ApiPropertyOptional({
    enum: ['NAMING_RIGHTS', 'PHYSICAL_BRANDING', 'SAMPLING_DEMO', 'POPUPS_EXPERIENCES'],
    default: 'NAMING_RIGHTS',
    description: 'Specific collaboration type',
  })
  @IsOptional()
  @IsString()
  collaborationType?: string;

  @ApiPropertyOptional({ description: 'Category-specific custom fields payload' })
  @IsOptional()
  dealData?: any;

  @ApiProperty({ example: 'Summer Space Activation' })
  @IsString()
  @MaxLength(200)
  projectName: string;

  @ApiPropertyOptional({ description: 'Free-form — a comma-separated string or an array of strings.' })
  @IsOptional()
  goals?: string | string[];

  @ApiPropertyOptional({ example: 'Level 3, Phoenix Marketcity, Bengaluru' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  venue?: string;

  @ApiPropertyOptional({ example: '6:00 PM onwards' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  time?: string;

  @ApiPropertyOptional({ description: 'Free-form — a comma-separated string or an array of strings.' })
  @IsOptional()
  targetAudience?: string | string[];

  @ApiProperty({ example: '2026-12-05T00:00:00.000Z' })
  @IsISO8601()
  startDate: string;

  @ApiPropertyOptional({ example: '2026-12-07T00:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @ApiProperty({ example: 45000 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sponsorshipAmount: number;

  @ApiPropertyOptional({ example: '10 VIP passes' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  barterElements?: string;

  @ApiProperty({ example: 'Booth setup, signage, 2 Instagram posts' })
  @IsString()
  @MaxLength(4000)
  deliverables: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  otherTerms?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  additionalNotes?: string;

  @ApiPropertyOptional({
    enum: ['BRAND', 'COMMUNITY', 'SPACE'],
    description: 'Which dashboard this was submitted from — only needed for accounts that own both the space and requester profile.',
  })
  @IsOptional()
  @IsEnum(['BRAND', 'COMMUNITY', 'SPACE'])
  asRole?: 'BRAND' | 'COMMUNITY' | 'SPACE';
}
