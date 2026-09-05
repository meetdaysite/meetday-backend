import { ArrayMaxSize, ArrayMinSize, IsArray, IsHexColor, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DeckSlideDto } from './deck-slide.dto';

export const DECK_THEMES = ['LIGHT', 'DARK', 'AUTO'] as const;
export type DeckTheme = (typeof DECK_THEMES)[number];

export const DECK_FONT_VIBES = ['MODERN_SANS', 'CLASSIC_SERIF', 'TECH_GEOMETRIC', 'MINIMALIST'] as const;
export type DeckFontVibe = (typeof DECK_FONT_VIBES)[number];

// Finalize step — renders the (possibly host-edited) slide plan into an actual PDF and uploads
// it to storage. Deliberately does NOT stream the PDF back for direct download — the response
// is a docKey meant to be attached to the proposal record, replacing the manual document upload.
export class FinalizeProposalDeckDto {
  @ApiProperty({ type: [DeckSlideDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DeckSlideDto)
  slides: DeckSlideDto[];

  @ApiProperty({ enum: DECK_THEMES })
  @IsIn(DECK_THEMES)
  theme: DeckTheme;

  @ApiProperty({ enum: DECK_FONT_VIBES })
  @IsIn(DECK_FONT_VIBES)
  fontVibe: DeckFontVibe;

  @ApiProperty({ type: [String], example: ['#EE2C2C', '#111111'], description: 'Up to 2 primary brand colors.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @IsHexColor({ each: true })
  primaryColors: string[];

  @ApiProperty({ type: [String], example: ['#FFC940', '#0EA5E9', '#22C55E'], description: 'Up to 3 accent/highlight colors.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsHexColor({ each: true })
  accentColors: string[];

  // Logo variant meant for DARK slide backgrounds (e.g. a white/light-colored logo file).
  @ApiPropertyOptional({ example: 'community-logos/abc123-dark.png' })
  @IsOptional()
  @IsString()
  primaryLogoKey?: string;

  // Logo variant meant for LIGHT slide backgrounds.
  @ApiPropertyOptional({ example: 'community-logos/abc123-light.png' })
  @IsOptional()
  @IsString()
  secondaryLogoKey?: string;

  @ApiPropertyOptional({ example: 'https://example.com/brand-guidelines.pdf' })
  @IsOptional()
  @IsString()
  mediaKitUrl?: string;

  // Up to 10 additional brand images — the first few are shown as a small gallery strip.
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  mediaAssetKeys?: string[];
}

export class FinalizeProposalDeckResponseDto {
  @ApiProperty()
  docKey: string;

  @ApiProperty()
  docName: string;

  @ApiProperty()
  docType: string;

  @ApiProperty()
  docSize: number;

  // Presigned, inline-viewable URL (no forced download) — used to show the deck in-app via
  // PdfViewer right after generating it, without waiting for the proposal itself to be saved.
  @ApiProperty()
  docUrl: string;
}
