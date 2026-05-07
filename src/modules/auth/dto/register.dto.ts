import {
  IsArray,
  IsEmail,
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
import { HostType } from '@prisma/client';
import { HostAddressDto, SocialLinksDto } from '../../hosts/dto/apply-host.dto';

export class RegisterDto {
  @ApiPropertyOptional({
    minLength: 1,
    maxLength: 50,
    example: 'Rahul',
    description: 'Required for email/phone sign-up. Optional for Google/Apple — falls back to the display name from the token.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  firstName?: string;

  @ApiPropertyOptional({
    minLength: 1,
    maxLength: 50,
    example: 'Sharma',
    description: 'Required for email/phone sign-up. Optional for Google/Apple — falls back to the display name from the token.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  lastName?: string;

  @ApiPropertyOptional({ description: 'E.164 format, e.g. +919876543210', example: '+919876543210' })
  @IsOptional()
  @Matches(/^\+[1-9]\d{7,14}$/, { message: 'phone must be in E.164 format' })
  phone?: string;

  @ApiPropertyOptional({
    description:
      'Required for HOST registration when signing up via phone+OTP (Firebase token carries no email). ' +
      'Ignored for email/Google/Apple sign-ups where the token already contains a verified email.',
    example: 'priya@example.com',
  })
  @IsOptional()
  @IsEmail({}, { message: 'email must be a valid email address' })
  email?: string;

  @ApiPropertyOptional({
    enum: ['USER', 'HOST'],
    default: 'USER',
    description:
      'Choose USER for a regular attendee account, HOST to register as an event host. ' +
      'HOST role is assigned immediately but the profile must complete KYC and admin approval before going live.',
  })
  @IsOptional()
  @IsEnum(['USER', 'HOST'], { message: 'accountType must be USER or HOST' })
  accountType?: 'USER' | 'HOST' = 'USER';

  // ── Host-specific fields (only used when accountType === 'HOST') ─────────────

  @ApiPropertyOptional({
    enum: HostType,
    description: 'Required when accountType is HOST.',
    example: 'INDIVIDUAL',
  })
  @IsOptional()
  @IsEnum(HostType)
  hostType?: HostType;

  @ApiPropertyOptional({
    description: 'Required when accountType is HOST. UUIDs from GET /categories.',
    type: [String],
    example: ['11111111-1111-1111-1111-111111111111'],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  categoryIds?: string[];

  @ApiPropertyOptional({
    maxLength: 100,
    example: 'Mumbai Walks by Rahul',
    description: 'Public-facing name shown to attendees.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string;

  @ApiPropertyOptional({
    maxLength: 200,
    example: 'Rahul Sharma',
    description: 'Full legal name or registered company name.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  legalName?: string;

  @ApiPropertyOptional({
    description: 'PAN card number. Stored encrypted. Required for TDS on payouts.',
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

  @ApiPropertyOptional({ minimum: 0, maximum: 50, example: 3 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  yearsOfExperience?: number;

  @ApiPropertyOptional({ minimum: 0, example: 25 })
  @IsOptional()
  @IsInt()
  @Min(0)
  totalEventsPreviouslyHosted?: number;

  @ApiPropertyOptional({ type: [String], example: ['Mumbai', 'Pune'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  operatingCities?: string[];

  @ApiPropertyOptional({ type: [String], example: ['https://insider.in/past-event'] })
  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  portfolioLinks?: string[];

  @ApiPropertyOptional({ type: SocialLinksDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SocialLinksDto)
  socialLinks?: SocialLinksDto;

  @ApiPropertyOptional({ type: HostAddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => HostAddressDto)
  address?: HostAddressDto;
}
