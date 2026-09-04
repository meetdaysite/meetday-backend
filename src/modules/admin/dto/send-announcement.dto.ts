import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

export class AnnouncementAttachmentDto {
  @ApiProperty({ example: 'document.pdf' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'announcements/attachments/uuid.pdf' })
  @IsString()
  key: string;

  @ApiPropertyOptional({ example: 1048576 })
  @IsOptional()
  @IsNumber()
  size?: number;

  @ApiProperty({ example: 'application/pdf' })
  @IsString()
  type: string;
}

export class SendAnnouncementDto {
  @ApiPropertyOptional({ description: 'Send to every brand account, ignoring brandIds.' })
  @IsOptional()
  @IsBoolean()
  allBrands?: boolean;

  @ApiPropertyOptional({ description: 'Send to every host/community account, ignoring hostIds.' })
  @IsOptional()
  @IsBoolean()
  allCommunity?: boolean;

  @ApiPropertyOptional({ type: [String], description: 'Specific brand profile IDs to email (ignored if allBrands is true).' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  brandIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Specific host profile IDs to email (ignored if allCommunity is true).' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  hostIds?: string[];

  @ApiPropertyOptional({ example: 'A quick update from Meetday', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @ApiProperty({ example: "We've just launched a new feature..." })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  message: string;

  @ApiPropertyOptional({
    example: 'All Brands, 3 Host(s)',
    description: 'Human-readable recipient summary for the Past Announcements history list.',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  recipientsSummary?: string;

  @ApiPropertyOptional({ type: [AnnouncementAttachmentDto], description: 'List of attached PDFs and images' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AnnouncementAttachmentDto)
  attachments?: AnnouncementAttachmentDto[];
}
