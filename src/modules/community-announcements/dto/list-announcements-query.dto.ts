import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListAnnouncementsQueryDto {
  @ApiPropertyOptional({
    description:
      'Cursor for the next page of the feed. Pass the `nextCursor` value returned by the ' +
      'previous response. This is the `publishedAt` ISO timestamp of the last item on that page. ' +
      'Omit (or pass `null`) for the first page. ' +
      'Note: pinned announcements are always prepended on the first page (when no cursor is ' +
      'provided) and do not consume slots from `limit`.',
    example: '2026-06-23T10:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  cursor?: string;

  @ApiPropertyOptional({
    description:
      'Maximum number of feed items to return per page. ' +
      'Pinned announcements are added on top of this count on the first page and are not ' +
      'included in the `nextCursor` calculation.',
    default: 20,
    minimum: 1,
    maximum: 50,
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}
