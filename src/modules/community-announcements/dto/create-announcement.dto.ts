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
  @ApiProperty({
    enum: AnnouncementCategory,
    enumName: 'AnnouncementCategory',
    description:
      'Category that drives the icon/badge shown to members in the feed.\n\n' +
      '- `EVENT_DROP` — new event or experience is now live\n' +
      '- `EVENT_REMINDER` — reminder for an upcoming event\n' +
      '- `COMMUNITY_UPDATE` — general community news or announcements\n' +
      '- `COMMUNITY_REMINDER` — community-specific reminder\n' +
      '- `GENERAL` — anything that does not fit the above',
    default: AnnouncementCategory.COMMUNITY_UPDATE,
    example: AnnouncementCategory.EVENT_DROP,
  })
  @IsEnum(AnnouncementCategory)
  category: AnnouncementCategory;

  @ApiProperty({
    description:
      'Short headline shown in the push notification title and in the announcement list card. ' +
      'Keep it punchy — members see this first.',
    example: 'Night Rituals Early Access',
    minLength: 3,
    maxLength: 140,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(140)
  title: string;

  @ApiProperty({
    description:
      'Full announcement body rendered on the detail screen. Plain text only — no markdown. ' +
      'The title is not repeated here; write this as the continuation of the headline.',
    example:
      'Get early access to Night Rituals before anyone else. Limited passes. Don\'t miss out!',
    minLength: 1,
    maxLength: 4000,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body: string;

  @ApiPropertyOptional({
    description:
      'Storage key returned by the `COMMUNITY_ANNOUNCEMENT` presigned-upload flow ' +
      '(`POST /storage/upload-url`). The server converts this key to a signed CDN URL ' +
      'before returning it in API responses as `imageUrl`. ' +
      'Omit to create a text-only announcement.',
    example: 'announcements/night-rituals-a1b2c3d4.jpg',
    maxLength: 512,
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  imageKey?: string;

  @ApiPropertyOptional({
    enum: AnnouncementStatus,
    enumName: 'AnnouncementStatus',
    description:
      'Lifecycle status that controls when (and whether) the announcement is sent to members.\n\n' +
      '- `PUBLISHED` *(default)* — fan-out to all active community members fires immediately ' +
      'after creation. `reachCount` is updated once the job completes.\n' +
      '- `SCHEDULED` — fan-out is delayed until `scheduledAt`. ' +
      '`scheduledAt` **must** be provided and must be a future datetime. ' +
      'The status transitions to `PUBLISHED` automatically when the job fires.\n' +
      '- `DRAFT` — saved without sending any notification. ' +
      'Use `PATCH /:id` to update content; publish it later by changing status to `PUBLISHED`.',
    default: AnnouncementStatus.PUBLISHED,
    example: AnnouncementStatus.PUBLISHED,
  })
  @IsOptional()
  @IsEnum(AnnouncementStatus)
  status?: AnnouncementStatus = AnnouncementStatus.PUBLISHED;

  @ApiPropertyOptional({
    description:
      'ISO 8601 datetime at which the announcement should be sent to members. ' +
      '**Required when `status` is `SCHEDULED`**; ignored otherwise. ' +
      'Must be in the future. The fan-out job fires at this exact time and sets ' +
      '`status → PUBLISHED` and `publishedAt` on the record.',
    example: '2026-07-01T10:00:00.000Z',
  })
  @ValidateIf((o) => o.status === AnnouncementStatus.SCHEDULED)
  @IsDateString()
  scheduledAt?: string;
}
