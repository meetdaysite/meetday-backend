import { IsISO8601, IsNumber, IsOptional, IsString, Min, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpsertBrandCommunityDealDto {
  @ApiPropertyOptional({ example: 'SPONSORSHIP', description: 'SPONSORSHIP | BRANDED_CONTENT | SAMPLING' })
  @IsOptional()
  @IsString()
  collaborationType?: string;

  @ApiPropertyOptional({ example: 'Brand & Community Offline Activation' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  projectName?: string;

  @ApiProperty({ example: '2026-12-05T00:00:00.000Z' })
  @IsISO8601()
  startDate: string;

  @ApiPropertyOptional({ example: '2026-12-07T00:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @ApiPropertyOptional({ example: '6:00 PM onwards' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  time?: string;

  @ApiPropertyOptional({ example: 'Community Activation' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  sponsorshipCategory?: string;

  @ApiPropertyOptional({ example: 'Bengaluru' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  venue?: string;

  @ApiPropertyOptional({ example: '100 samples distributed' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  barterElements?: string;

  @ApiPropertyOptional({ example: 45000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sponsorshipAmount?: number;

  @ApiProperty({ example: 'Agreed deliverables' })
  @IsString()
  @MaxLength(4000)
  deliverables: string;

  @ApiPropertyOptional({ example: 'Other notes or terms' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  otherTerms?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  additionalNotes?: string;

  @ApiPropertyOptional({ description: 'Flexible domain-specific fields payload' })
  @IsOptional()
  dealData?: any;
}
