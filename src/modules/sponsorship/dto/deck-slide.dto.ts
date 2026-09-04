import { IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Every slide in the fixed 10-slide deck template is one of these layouts — layout assignment
// per slide position is deterministic (see ProposalDeckContentService.generatePlan), not chosen
// by the AI; the AI's job is purely filling in fallback COPY for empty optional fields.
export const DECK_SLIDE_LAYOUTS = [
  'COVER',
  'VALUE_PROP',
  'STAT_HIGHLIGHT',
  'BULLET_LIST',
  'PAST_SPONSORS',
  'PRICING_COMPARISON',
  'CLOSING_CONTACT',
] as const;
export type DeckSlideLayout = (typeof DECK_SLIDE_LAYOUTS)[number];

export class DeckPricingTierDto {
  @ApiProperty({ example: 'Gold Sponsor' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: '₹50,000' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  price: string;
}

export class DeckStatDto {
  @ApiProperty({ example: 'Expected Guests' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  label: string;

  @ApiProperty({ example: '150+' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  value: string;
}

export class PastSponsorDto {
  @ApiProperty({ example: 'Acme Beverages' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'past-sponsor-logos/abc123.png' })
  @IsOptional()
  @IsString()
  logoKey?: string;

  @ApiPropertyOptional({ example: 'Night Rituals Vol. 3' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  projectReference?: string;
}

// A single editable slide — the shape is a superset covering every layout; only the fields
// relevant to `layout` are meaningful/rendered, the rest are ignored.
export class DeckSlideDto {
  @ApiProperty({ enum: DECK_SLIDE_LAYOUTS })
  @IsIn(DECK_SLIDE_LAYOUTS)
  layout: DeckSlideLayout;

  @ApiProperty({ example: 'Why Sponsor This' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title: string;

  @ApiPropertyOptional({ example: 'Night Rituals — Kolkata Music Fest' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  subtitle?: string;

  @ApiPropertyOptional({ example: 'Sponsoring this event puts your brand in front of an engaged audience...' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  body?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  bullets?: string[];

  @ApiPropertyOptional({ type: [DeckStatDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeckStatDto)
  stats?: DeckStatDto[];

  @ApiPropertyOptional({ type: [DeckPricingTierDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeckPricingTierDto)
  pricingTiers?: DeckPricingTierDto[];

  @ApiPropertyOptional({ example: 'Priya Nair' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  contactName?: string;

  @ApiPropertyOptional({ example: 'priya@example.com' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  contactEmail?: string;

  @ApiPropertyOptional({ example: '+91 98765 43210' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  contactPhone?: string;

  @ApiPropertyOptional({ type: [PastSponsorDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PastSponsorDto)
  pastSponsors?: PastSponsorDto[];

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  openToBarter?: boolean;

  @ApiPropertyOptional({ example: '2026-10-15' })
  @IsOptional()
  @IsString()
  sponsorshipDeadline?: string;
}
