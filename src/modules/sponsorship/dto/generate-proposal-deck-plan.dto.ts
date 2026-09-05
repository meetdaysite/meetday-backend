import { ArrayMaxSize, IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DeckPricingTierDto, DeckSlideDto, PastSponsorDto } from './deck-slide.dto';

// Plan step — the full "Proposal Deck Form" content goes in (narrative/copy fields optional,
// AI fills fallbacks for whichever are empty), an editable 10-slide array comes back. Not
// personalized to any one brand, since this replaces the proposal's shared "Choose Document".
export class GenerateProposalDeckPlanDto {
  @ApiProperty({ example: 'Acme Community' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  hostName: string;

  @ApiProperty({ example: 'Night Rituals — Kolkata Music Fest' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  eventTitle: string;

  @ApiPropertyOptional({ example: 'Where the city comes alive after dark', description: 'Max 80 characters.' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  tagline?: string;

  @ApiPropertyOptional({ example: 'A monthly music showcase bringing together local artists and fans...' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  aboutCommunity?: string;

  @ApiPropertyOptional({ example: 'A night of live music, food, and community, held monthly across the city.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  eventOverview?: string;

  @ApiPropertyOptional({ example: 'Sponsoring this event puts your brand in front of an engaged, in-person audience...' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  sponsorROIPitch?: string;

  @ApiPropertyOptional({ example: 'Kolkata / The Warehouse District' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @ApiPropertyOptional({ example: '2026-10-15', description: 'Event date(s) — a single date or a range as free text.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  eventDate?: string;

  @ApiPropertyOptional({ example: '7:00 PM – 11:00 PM' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  eventTime?: string;

  @ApiPropertyOptional({ example: '1,200' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  heroMetricValue?: string;

  @ApiPropertyOptional({ example: 'Attendees' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  heroMetricLabel?: string;

  @ApiPropertyOptional({ example: 'Early-stage founders & investors' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  targetAudienceProfile?: string;

  @ApiPropertyOptional({ type: [PastSponsorDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => PastSponsorDto)
  pastSponsors?: PastSponsorDto[];

  @ApiPropertyOptional({ type: [DeckPricingTierDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeckPricingTierDto)
  sponsorTiers?: DeckPricingTierDto[];

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  openToBarter?: boolean;

  @ApiPropertyOptional({ example: '2026-10-15' })
  @IsOptional()
  @IsString()
  sponsorshipDeadline?: string;

  @ApiPropertyOptional({ example: 'Stage banner, booth space, on-ground announcements' })
  @IsOptional()
  @IsString()
  @MaxLength(1500)
  onsiteDeliverables?: string;

  @ApiPropertyOptional({ example: 'Instagram shoutouts, newsletter mention, WhatsApp broadcast' })
  @IsOptional()
  @IsString()
  @MaxLength(1500)
  digitalDeliverables?: string;

  @ApiPropertyOptional({ example: 'Meet-and-greet with performers, VIP lounge access' })
  @IsOptional()
  @IsString()
  @MaxLength(1500)
  customPerks?: string;
}

export class GenerateProposalDeckPlanResponseDto {
  @ApiProperty({ type: [DeckSlideDto] })
  slides: DeckSlideDto[];
}

