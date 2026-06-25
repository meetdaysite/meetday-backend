import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AnnouncementCategory, AnnouncementStatus } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateAnnouncementDto {
  @ApiProperty({ enum: AnnouncementCategory, default: AnnouncementCategory.COMMUNITY_UPDATE })
  @IsEnum(AnnouncementCategory)
  category: AnnouncementCategory;

  @ApiProperty({ example: 'Neon Nights Early Access Opens Tomorrow!' })
  @IsString()
  @MinLength(3)
  @MaxLength(140)
  title: string;

  @ApiProperty({ example: 'Early access tickets for Neon Nights go live tomorrow at 12 PM.' })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body: string;

  @ApiPropertyOptional({ description: 'S3 key from the COMMUNITY_ANNOUNCEMENT upload context' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  imageKey?: string;

  @ApiPropertyOptional({ enum: AnnouncementStatus, default: AnnouncementStatus.PUBLISHED })
  @IsOptional()
  @IsEnum(AnnouncementStatus)
  status?: AnnouncementStatus = AnnouncementStatus.PUBLISHED;

  @ApiPropertyOptional({
    description: 'Required when status=SCHEDULED. ISO 8601 datetime in the future.',
    example: '2026-07-01T10:00:00.000Z',
  })
  @ValidateIf((o) => o.status === AnnouncementStatus.SCHEDULED)
  @IsDateString()
  scheduledAt?: string;
}
