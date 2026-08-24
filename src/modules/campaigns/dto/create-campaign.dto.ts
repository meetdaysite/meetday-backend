import {
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsEnum,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SponsorshipStatus } from '@prisma/client';

export class CreateCampaignDto {
  @ApiPropertyOptional({ example: 'Figma Q3 Sampling Campaign' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'Product Sampling' })
  @IsOptional()
  @IsString()
  goal?: string;

  @ApiPropertyOptional({ type: [String], example: ['Delhi', 'Mumbai'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  locations?: string[];

  @ApiPropertyOptional({ type: [String], example: ['Tech Developers', 'Creative Designers'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  audience?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ example: 'CASH' })
  @IsOptional()
  @IsString()
  offerType?: string; // "CASH", "BARTER", "BOTH"

  @ApiPropertyOptional({ example: 50000 })
  @IsOptional()
  @IsNumber()
  budgetAmount?: number;

  @ApiPropertyOptional({ example: 'INR' })
  @IsOptional()
  @IsString()
  budgetCurrency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  barterElements?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: SponsorshipStatus, default: SponsorshipStatus.DRAFT })
  @IsOptional()
  @IsEnum(SponsorshipStatus)
  status?: SponsorshipStatus;
}
