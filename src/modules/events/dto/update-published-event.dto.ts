import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CreateEventMediaDto } from './create-event.dto';

/** True when the payload touches any location field (Tier 2 venue block). */
function touchesLocation(o: UpdatePublishedEventDto): boolean {
  return (
    o.venueName !== undefined ||
    o.fullAddress !== undefined ||
    o.city !== undefined ||
    o.latitude !== undefined ||
    o.longitude !== undefined
  );
}

/**
 * Editable fields for an already-PUBLISHED event, submitted as an admin-reviewed revision.
 *
 * Only the whitelisted Tier 1 (content) and Tier 2 (venue) fields live here — locked fields
 * (eventDate/startTime/endTime, tickets, refundPolicy, isFree, visibility, ageRestriction) are
 * deliberately absent, so the global `forbidNonWhitelisted` ValidationPipe rejects any attempt
 * to change them through this route.
 *
 * All fields are optional; only the ones present are proposed as changes. Whenever any location
 * field changes, up-to-date `latitude` + `longitude` must accompany it so the map pin never drifts
 * and the minor/major materiality classifier can measure the move.
 */
export class UpdatePublishedEventDto {
  // ─── Tier 1: content ───────────────────────────────────────────────────────
  @ApiPropertyOptional({ example: 'uuid-of-category' })
  @IsOptional()
  @IsUUID('4')
  categoryId?: string;

  @ApiPropertyOptional({ example: 'Photography Walk in Bandra', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ example: 'Join us for a curated photography walk...' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'Workshop', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  eventType?: string;

  @ApiPropertyOptional({ type: [String], example: ['English', 'Hindi'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  languages?: string[];

  @ApiPropertyOptional({ type: [String], example: ['photography', 'mumbai'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ type: [String], example: ['Guided walk', 'Tips on street photography'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  whatToExpect?: string[];

  @ApiPropertyOptional({ type: [String], example: ['Photography enthusiasts', 'Beginners welcome'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  whoShouldAttend?: string[];

  @ApiPropertyOptional({ example: 'Bring a DSLR or mirrorless camera.' })
  @IsOptional()
  @IsString()
  specialInstructions?: string;

  @ApiPropertyOptional({
    type: [CreateEventMediaDto],
    description:
      'Replaces all existing media when provided. Send the full desired set (existing keys + new ones), ' +
      'not just the additions — same contract as the draft update.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateEventMediaDto)
  media?: CreateEventMediaDto[];

  // ─── Tier 2: venue (material — triggers attendee notice on approval) ─────────
  @ApiPropertyOptional({ example: 'Carter Road Promenade', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  venueName?: string;

  @ApiPropertyOptional({ example: 'Carter Road, Bandra West, Mumbai', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  fullAddress?: string;

  @ApiPropertyOptional({ example: 'Mumbai' })
  @IsOptional()
  @IsString()
  city?: string;

  // Coordinates are required whenever any location field changes (no @IsOptional): the
  // ValidateIf gate makes @IsNumber run — and therefore fail on an absent value — in that case.
  @ApiPropertyOptional({ example: 19.0596, description: 'Required when any location field changes.' })
  @ValidateIf((o) => touchesLocation(o))
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional({ example: 72.8295, description: 'Required when any location field changes.' })
  @ValidateIf((o) => touchesLocation(o))
  @IsNumber()
  longitude?: number;
}
