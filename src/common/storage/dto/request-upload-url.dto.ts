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
  COMMUNITY_ANNOUNCEMENT = 'COMMUNITY_ANNOUNCEMENT',
  COMMUNITY_DM_MEDIA = 'COMMUNITY_DM_MEDIA',
  COMMUNITY_FEED_MEDIA = 'COMMUNITY_FEED_MEDIA',
}

const ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'application/pdf', // host documents
] as const;

export class RequestUploadUrlDto {
  @ApiProperty({ enum: UploadContext, description: 'The upload context determines the key path and authorization rules.' })
  @IsEnum(UploadContext)
  context: UploadContext;

  @ApiProperty({ enum: ALLOWED_CONTENT_TYPES, example: 'image/jpeg' })
  @IsIn(ALLOWED_CONTENT_TYPES)
  contentType: (typeof ALLOWED_CONTENT_TYPES)[number];

  @ApiPropertyOptional({
    description:
      'UUID of the related resource — semantics depend on context: event (EVENT_MEDIA, optional), ' +
      'interest (INTEREST_IMAGE), community (COMMUNITY_COVER/ICON optional, COMMUNITY_ANNOUNCEMENT/FEED_MEDIA required), ' +
      'conversation (COMMUNITY_DM_MEDIA required). Not used for USER_AVATAR / HOST_DOCUMENT / REVIEW_PHOTO.',
  })
  @IsOptional()
  @IsUUID()
  resourceId?: string;

  @ApiPropertyOptional({ enum: MediaType, description: 'Required for EVENT_MEDIA (COVER / GALLERY / VIDEO).' })
  @IsOptional()
  @IsEnum(MediaType)
  mediaType?: MediaType;
}
