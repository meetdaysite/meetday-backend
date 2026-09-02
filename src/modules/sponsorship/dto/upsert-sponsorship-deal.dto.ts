import { IsISO8601, IsNumber, IsOptional, IsString, Min, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpsertSponsorshipDealDto {
  @ApiProperty({ example: 'Summer Music Fest — Title Sponsorship' })
  @IsString()
  @MaxLength(200)
  projectName: string;

  @ApiProperty({ example: '2026-12-05T00:00:00.000Z' })
  @IsISO8601()
  startDate: string;

  @ApiPropertyOptional({ example: '2026-12-07T00:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @ApiPropertyOptional({ example: '6:00 PM onwards' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  time?: string;

  @ApiPropertyOptional({ example: 'Music Festival' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  sponsorshipCategory?: string;

  @ApiProperty({ example: 'Phoenix Marketcity, Bengaluru' })
  @IsString()
  @MaxLength(300)
  venue: string;

  @ApiPropertyOptional({ example: '10 VIP passes' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  barterElements?: string;

  @ApiProperty({ example: 45000 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sponsorshipAmount: number;

  @ApiProperty({ example: 'Logo on stage backdrop, 2 Instagram posts, on-site booth' })
  @IsString()
  @MaxLength(4000)
  deliverables: string;

  @ApiPropertyOptional({ example: 'Payment in 2 tranches — 50% upfront, 50% post-event' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  otherTerms?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  additionalNotes?: string;
}
