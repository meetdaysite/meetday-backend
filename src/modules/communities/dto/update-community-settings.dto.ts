import { IsBoolean, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ChatPermission,
  DirectMessagePolicy,
  PhotoSharingPolicy,
  PostingPermission,
} from '@prisma/client';

/**
 * Step 2 — Community Rules. All fields optional so the form can be saved
 * incrementally; the service upserts the CommunitySettings row.
 */
export class UpdateCommunitySettingsDto {
  // Features
  @ApiPropertyOptional() @IsOptional() @IsBoolean() chatEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() feedEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() announcementsEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() memberDirectoryEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() experiencesTabEnabled?: boolean;

  // Posting & chat permissions
  @ApiPropertyOptional({ enum: PostingPermission })
  @IsOptional()
  @IsEnum(PostingPermission)
  feedPosting?: PostingPermission;

  @ApiPropertyOptional({ enum: ChatPermission })
  @IsOptional()
  @IsEnum(ChatPermission)
  chat?: ChatPermission;

  // Auto moderation
  @ApiPropertyOptional() @IsOptional() @IsBoolean() spamDetection?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() toxicContentDetection?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() linkFiltering?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() duplicateContentDetection?: boolean;

  @ApiPropertyOptional({ example: 5, minimum: 1, maximum: 100, description: 'Auto-hide content after N reports' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  reportThreshold?: number;

  // Safety
  @ApiPropertyOptional({ enum: DirectMessagePolicy })
  @IsOptional()
  @IsEnum(DirectMessagePolicy)
  dmPolicy?: DirectMessagePolicy;

  @ApiPropertyOptional({ enum: PhotoSharingPolicy })
  @IsOptional()
  @IsEnum(PhotoSharingPolicy)
  photoSharing?: PhotoSharingPolicy;
}
