import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

export class UpsertBrandCommunityDealReportDto {
  @ApiPropertyOptional({ example: 'Event Activation' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  projectName?: string;

  @ApiPropertyOptional({ example: '2026-12-05' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  eventDate?: string;

  @ApiPropertyOptional({ example: 'Bengaluru' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  venue?: string;

  @ApiPropertyOptional({ example: '6 PM - 9 PM' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  time?: string;

  @ApiPropertyOptional({ example: '200' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  guestCount?: string;

  @ApiPropertyOptional({ example: '20-35' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  ageRange?: string;

  @ApiPropertyOptional({
    description: 'Checklist deliverables mapping',
    example: [{ text: 'Delivered', checked: true }],
  })
  @IsOptional()
  deliverables?: any;

  @ApiPropertyOptional({
    type: [String],
    description: 'Up to 5 video URLs',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  videoLinks?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Up to 10 social links',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  socialLinks?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Evidence media keys uploaded to S3',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  mediaKeys?: string[];

  @ApiPropertyOptional({ example: 'Summary of the executed deliverables' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  summary?: string;

  @ApiPropertyOptional()
  @IsOptional()
  reportData?: any;
}
