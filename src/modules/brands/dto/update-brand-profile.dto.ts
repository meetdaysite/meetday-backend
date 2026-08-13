import { IsArray, IsEmail, IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CompanyType } from '@prisma/client';
import { SocialLinksDto } from '../../hosts/dto/apply-host.dto';

export const INDUSTRY_OPTIONS = [
  'Tech/SaaS',
  'Food & Beverage',
  'Fashion/Apparel',
  'Consumer Tech',
  'Health & Wellness',
  'FinTech',
  'Entertainment',
  'Alcobev',
] as const;

export class UpdateBrandProfileDto {
  @ApiPropertyOptional({ maxLength: 100, example: 'Acme Corp' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  brandName?: string;

  @ApiPropertyOptional({ type: [String], description: 'Category UUIDs the brand is interested in' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  categoryIds?: string[];

  @ApiPropertyOptional({ type: SocialLinksDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SocialLinksDto)
  socialLinks?: SocialLinksDto;

  @ApiPropertyOptional({ example: 'priya@acmecorp.com', description: 'Work email, distinct from the login email' })
  @IsOptional()
  @IsEmail()
  workEmail?: string;

  @ApiPropertyOptional({ description: 'E.164 format, e.g. +919876543210' })
  @IsOptional()
  @Matches(/^\+[1-9]\d{7,14}$/, { message: 'contactPhone must be in E.164 format' })
  contactPhone?: string;

  @ApiPropertyOptional({ description: 'GCS object key for the uploaded company logo' })
  @IsOptional()
  @IsString()
  logoKey?: string;

  @ApiPropertyOptional({ enum: CompanyType })
  @IsOptional()
  @IsEnum(CompanyType)
  companyType?: CompanyType;

  @ApiPropertyOptional({ maxLength: 1000, example: 'We build productivity tools for remote teams.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  aboutCompany?: string;

  @ApiPropertyOptional({
    example: 'Tech/SaaS',
    description: `One of: ${INDUSTRY_OPTIONS.join(', ')}, or a custom value.`,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  industry?: string;
}
