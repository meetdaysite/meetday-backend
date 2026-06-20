import { IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MediaType } from '@prisma/client';

export enum UploadContext {
  EVENT_MEDIA = 'EVENT_MEDIA',
  USER_AVATAR = 'USER_AVATAR',
  HOST_DOCUMENT = 'HOST_DOCUMENT',
  INTEREST_IMAGE = 'INTEREST_IMAGE',
  REVIEW_PHOTO = 'REVIEW_PHOTO',
  COMMUNITY_COVER = 'COMMUNITY_COVER',
  COMMUNITY_ICON = 'COMMUNITY_ICON',
}

const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'] as const;

export class RequestUploadUrlDto {
  @ApiProperty({ enum: UploadContext, description: 'The upload context determines the key path and authorization rules.' })
  @IsEnum(UploadContext)
  context: UploadContext;

  @ApiProperty({ enum: ALLOWED_CONTENT_TYPES, example: 'image/jpeg' })
  @IsIn(ALLOWED_CONTENT_TYPES)
  contentType: (typeof ALLOWED_CONTENT_TYPES)[number];

  @ApiPropertyOptional({ description: 'Required for EVENT_MEDIA. The event UUID.' })
  @IsOptional()
  @IsUUID()
  resourceId?: string;

  @ApiPropertyOptional({ enum: MediaType, description: 'Required for EVENT_MEDIA.' })
  @IsOptional()
  @IsEnum(MediaType)
  mediaType?: MediaType;
}
