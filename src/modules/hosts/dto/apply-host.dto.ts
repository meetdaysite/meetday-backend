import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Gender, HostType } from '@prisma/client';

export class SocialLinksDto {
  @ApiPropertyOptional({ example: 'https://instagram.com/yourhandle' })
  @IsOptional()
  @IsUrl()
  instagram?: string;

  @ApiPropertyOptional({ example: 'https://linkedin.com/in/yourprofile' })
  @IsOptional()
  @IsUrl()
  linkedin?: string;

  @ApiPropertyOptional({ example: 'https://youtube.com/@yourchannel' })
  @IsOptional()
  @IsUrl()
  youtube?: string;

  @ApiPropertyOptional({ example: 'https://yourwebsite.com' })
  @IsOptional()
  @IsUrl()
  website?: string;
}

export class HostAddressDto {
  @ApiProperty({ example: '12, Linking Road' })
  @IsString()
  @MinLength(1)
  addressLine1: string;

  @ApiPropertyOptional({ example: 'Bandra West' })
  @IsOptional()
  @IsString()
  addressLine2?: string;

  @ApiProperty({ example: 'Mumbai' })
  @IsString()
  city: string;

  @ApiProperty({ example: 'Maharashtra' })
  @IsString()
  state: string;

  @ApiProperty({ example: '400050', description: '6-digit Indian pincode' })
  @Matches(/^\d{6}$/, { message: 'pincode must be a 6-digit number' })
  pincode: string;

  @ApiPropertyOptional({ example: 'India', default: 'India' })
  @IsOptional()
  @IsString()
  country?: string;
}

export class ApplyHostDto {
  @ApiProperty({
    enum: HostType,
    description: 'Whether you are registering as an individual host or a business entity',
    example: 'INDIVIDUAL',
  })
  @IsEnum(HostType)
  hostType: HostType;

  @ApiPropertyOptional({ enum: Gender, description: 'Host gender', example: 'MALE' })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional({
    maxLength: 100,
    description: 'Public-facing name shown to attendees. Defaults to first + last name if not set.',
    example: 'Mumbai Walks by Rahul',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string;

  @ApiPropertyOptional({
    maxLength: 200,
    description: 'Full legal name (individual) or registered company name (business). Used for compliance and contracts.',
    example: 'Rahul Sharma' ,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  legalName?: string;

  @ApiPropertyOptional({
    description: 'PAN card number. Required for TDS on payouts. Stored encrypted.',
    example: 'ABCDE1234F',
  })
  @IsOptional()
  @Matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/, { message: 'PAN must be in the format ABCDE1234F' })
  pan?: string;

  @ApiPropertyOptional({ maxLength: 1000, example: 'I run weekly photography walks across Mumbai.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  hostBio?: string;

  @ApiPropertyOptional({ maxLength: 200, example: 'Discover Mumbai through a lens' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  tagline?: string;

  @ApiPropertyOptional({ type: [String], example: ['English', 'Hindi', 'Marathi'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  languages?: string[];

  @ApiPropertyOptional({
    description: 'Self-reported years of event hosting experience',
    minimum: 0,
    maximum: 50,
    example: 3,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  yearsOfExperience?: number;

  @ApiPropertyOptional({
    description: 'Self-reported count of events previously hosted',
    minimum: 0,
    example: 25,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  totalEventsPreviouslyHosted?: number;

  @ApiPropertyOptional({
    type: [String],
    description: 'Cities the host is willing to operate in beyond their base city',
    example: ['Mumbai', 'Pune', 'Nashik'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  operatingCities?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'URLs to past event pages, press coverage, or portfolio',
    example: ['https://insider.in/past-event', 'https://youtu.be/abc'],
  })
  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  portfolioLinks?: string[];

  @ApiPropertyOptional({
    description: 'S3 key for the host avatar, returned from POST /storage/upload-url with context USER_AVATAR.',
    example: 'users/user-uuid/avatar/abc123.jpg',
  })
  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @ApiProperty({
    type: [String],
    description: 'At least one category UUID required. Get IDs from GET /categories.',
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one category is required' })
  @IsUUID('4', { each: true })
  categoryIds: string[];

  @ApiPropertyOptional({ type: SocialLinksDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SocialLinksDto)
  socialLinks?: SocialLinksDto;

  @ApiPropertyOptional({
    type: HostAddressDto,
    description: 'Structured address of the host. city here is used as the base city.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => HostAddressDto)
  address?: HostAddressDto;
}
