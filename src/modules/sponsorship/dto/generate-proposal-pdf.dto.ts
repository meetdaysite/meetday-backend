import { IsArray, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProposalPdfPricingTierDto {
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

export class GenerateProposalPdfDto {
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

  @ApiProperty({ example: 'Stage banner, social media shoutouts, on-ground booth' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(3000)
  deliverables: string;

  @ApiProperty({ example: 'Campaign runs 1 Oct – 15 Nov, deliverables live by 20 Oct' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  timeline: string;

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
