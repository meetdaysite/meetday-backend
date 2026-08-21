import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, IsEnum } from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

export class UpsertSponsorshipDealReportDto {
  @ApiProperty({ example: 'Set up a branded booth at the entrance and ran 3 Instagram stories.' })
  @IsString()
  @MaxLength(4000)
  summary: string;

  @ApiPropertyOptional({ example: 'Tech Conference 2026' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  projectName?: string;

  @ApiPropertyOptional({ example: '2026-08-25' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  eventDate?: string;

  @ApiPropertyOptional({ example: 'Convention Center, Hall A' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  venue?: string;

  @ApiPropertyOptional({ example: '9 AM - 5 PM' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  time?: string;

  @ApiPropertyOptional({ example: '500+' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  guestCount?: string;

  @ApiPropertyOptional({ example: '18-25' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  ageRange?: string;

  @ApiPropertyOptional({
    description: 'Checklist deliverables mapping',
    example: [{ text: 'Stories', checked: true }],
  })
  @IsOptional()
  deliverables?: any;

  @ApiPropertyOptional({
    type: [String],
    description: 'Up to 5 video URLs',
    example: ['https://youtube.com/watch?v=123'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  videoLinks?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Up to 5 social media links',
    example: ['https://instagram.com/p/123'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  socialLinks?: string[];

  @ApiPropertyOptional({
    enum: ['PENDING', 'APPROVED', 'REVISION_REQUESTED'],
    default: 'PENDING',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 'Please upload a higher resolution photo.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  revisionNote?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Up to 6 GCS object keys from POST /storage/upload-url (SPONSORSHIP_DEAL_REPORT_MEDIA context)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  proofKeys?: string[];

  @ApiPropertyOptional({ example: 'Footfall was higher than expected, brand rep was on-site for the full event.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
