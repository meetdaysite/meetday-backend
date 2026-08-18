import { IsArray, IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

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
}
