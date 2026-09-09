import { IsArray, IsBoolean, IsIn, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
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

// A per-element override for the post-generation slide editor — position/size are offsets from
// the element's default template position (not absolute coordinates), so a slide with no
// overrides at all renders identically to the original fixed template. Values are clamped
// server-side in ProposalPdfGeneratorService regardless of what the client sends.
export class DeckElementStyleDto {
  @ApiPropertyOptional({ description: 'Horizontal offset in px from default position' })
  @IsOptional()
  @IsNumber()
  x?: number;

  @ApiPropertyOptional({ description: 'Vertical offset in px from default position' })
  @IsOptional()
  @IsNumber()
  y?: number;

  @ApiPropertyOptional({ description: 'Scale multiplier applied to the element\'s default size' })
  @IsOptional()
  @IsNumber()
  scale?: number;

  @ApiPropertyOptional({ description: 'Font size in px (text elements only)' })
  @IsOptional()
  @IsNumber()
  fontSize?: number;

  @ApiPropertyOptional({ example: 'serif' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  fontFamily?: string;

  @ApiPropertyOptional({ example: '#111111' })
  @IsOptional()
  @IsString()
  @MaxLength(9)
  color?: string;

  @ApiPropertyOptional({ description: 'Font weight (text elements only)' })
  @IsOptional()
  @IsNumber()
  fontWeight?: number;
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

  // Post-generation editor state — keyed by a stable element "slot" id (e.g. "title", "body",
  // "kicker", "hero", "gallery-0"). Only slots present in the current layout are meaningful;
  // unknown/stale keys (e.g. left over from switching layouts) are silently ignored at render time.
  @ApiPropertyOptional({ description: 'Per-element position/size/font overrides, keyed by element slot id' })
  @IsOptional()
  @IsObject()
  elementStyles?: Record<string, DeckElementStyleDto>;

  // Replacement image GCS keys per image slot id (e.g. "hero", "gallery-0", "gallery-1") — lets
  // the user swap an AI/host-picked image after seeing the generated slide, without regenerating
  // the whole deck. Resolved to a data URI the same way as the deck's other images.
  @ApiPropertyOptional({ description: 'Replacement image keys per image slot id' })
  @IsOptional()
  @IsObject()
  imageOverrides?: Record<string, string>;
}
