import { IsArray, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DeckPricingTierDto, DeckSlideDto } from './deck-slide.dto';

// Plan step — proposal's own content fields go in, an editable slide array comes back (not
// personalized to any one brand, since this replaces the proposal's shared "Choose Document").
export class GenerateProposalDeckPlanDto {
  @ApiProperty({ example: 'Night Rituals — Kolkata Music Fest' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  eventName: string;

  @ApiProperty({ example: 'A monthly music showcase bringing together local artists and fans...' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(3000)
  about: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  venues?: string[];

  @ApiPropertyOptional({ example: '2026-11-15' })
  @IsOptional()
  @IsString()
  eventDate?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  audienceProfile?: string[];

  @ApiPropertyOptional({ example: '21-40' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  ageGroup?: string;

  @ApiPropertyOptional({ example: '150' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  guestCount?: string;

  @ApiPropertyOptional({ type: [DeckPricingTierDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeckPricingTierDto)
  sponsorTiers?: DeckPricingTierDto[];
}

export class GenerateProposalDeckPlanResponseDto {
  @ApiProperty({ type: [DeckSlideDto] })
  slides: DeckSlideDto[];
}
