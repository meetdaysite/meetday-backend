import { ApiPropertyOptional } from '@nestjs/swagger';
import { AnnouncementStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export class AdminListAnnouncementsQueryDto {
  @ApiPropertyOptional({
    enum: AnnouncementStatus,
    enumName: 'AnnouncementStatus',
    description:
      'Filter by lifecycle status. Omit to return all non-deleted announcements ' +
      'regardless of status (i.e. the "All Announcements" view in the admin dashboard).',
    example: AnnouncementStatus.PUBLISHED,
  })
  @IsOptional()
  @IsEnum(AnnouncementStatus)
  status?: AnnouncementStatus;

  @ApiPropertyOptional({
    description: '1-based page number. Matches the numbered page buttons shown in the admin UI.',
    default: 1,
    minimum: 1,
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Number of announcements to return per page.',
    default: 10,
    minimum: 1,
    maximum: 50,
    example: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;
}
