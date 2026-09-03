import { IsArray, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProposalPdfPricingTierDto } from './generate-proposal-pdf.dto';

// The final render step — takes the (optionally user-edited) AI-expanded slide copy plus the
// original structured fields (pricing/contact) and produces the actual multi-slide PDF.
// Deliberately separate from GenerateProposalPdfDto: the deck format has 6 fixed slides with
// distinct expanded-copy fields, not a single flowing document.
export class GenerateProposalDeckPdfDto {
  @ApiProperty({ example: 'Acme Beverages' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  sponsorName: string;

  @ApiProperty({ example: 'Night Rituals — Kolkata Music Fest' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  eventTitle: string;

  @ApiProperty({ example: 'Sponsoring Night Rituals puts your brand in front of an engaged, in-person audience...' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  valueProposition: string;

  @ApiProperty({ example: 'Night Rituals is a monthly music showcase bringing together...' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  campaignOverview: string;

  @ApiProperty({ example: 'Expect a crowd of music enthusiasts and young professionals...' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  audienceReach: string;

  @ApiProperty({ example: 'Your brand will be featured on the main stage banner...' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(3000)
  deliverablesExpanded: string;

  @ApiProperty({ example: 'The campaign kicks off October 1st and runs through November 15th...' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1500)
  timelineExpanded: string;

  @ApiPropertyOptional({ type: [ProposalPdfPricingTierDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProposalPdfPricingTierDto)
  pricingTiers?: ProposalPdfPricingTierDto[];

  @ApiProperty({ example: 'Full payment due upfront; non-refundable after event date is confirmed.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(3000)
  terms: string;

  @ApiProperty({ example: 'Priya Nair' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  contactName: string;

  @ApiProperty({ example: 'priya@example.com' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  contactEmail: string;

  @ApiPropertyOptional({ example: '+91 98765 43210' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  contactPhone?: string;
}
