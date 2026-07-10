import { IsEnum, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { MediaType } from '@prisma/client';

const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'] as const;

export class RequestUploadUrlDto {
  @ApiProperty({ enum: ALLOWED_CONTENT_TYPES, example: 'image/jpeg' })
  @IsIn(ALLOWED_CONTENT_TYPES)
  contentType: (typeof ALLOWED_CONTENT_TYPES)[number];

  @ApiProperty({ enum: MediaType, example: 'COVER' })
  @IsEnum(MediaType)
  type: MediaType;
}
