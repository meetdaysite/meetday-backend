import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DmMessageType } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateIf } from 'class-validator';

export class CreateIntroDto {
  @ApiProperty({ description: 'The member to introduce yourself to', format: 'uuid' })
  @IsUUID()
  targetUserId: string;

  @ApiPropertyOptional({ description: 'Intro message text (required unless an image is attached).', maxLength: 2000 })
  @ValidateIf((o) => !o.mediaKey)
  @IsString()
  @MaxLength(2000)
  content?: string;

  @ApiPropertyOptional({ enum: DmMessageType, default: DmMessageType.TEXT })
  @IsOptional()
  @IsEnum(DmMessageType)
  messageType?: DmMessageType;

  @ApiPropertyOptional({ description: 'S3 key from a COMMUNITY_DM_MEDIA upload (image intro).' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  mediaKey?: string;

  @ApiPropertyOptional({ description: 'Image size in bytes.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  mediaSizeBytes?: number;
}
