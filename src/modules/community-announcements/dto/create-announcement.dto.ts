import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AnnouncementCategory } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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
}
