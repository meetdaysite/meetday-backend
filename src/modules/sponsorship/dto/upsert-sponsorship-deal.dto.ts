import { IsISO8601, IsNumber, IsOptional, IsString, Min, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpsertSponsorshipDealDto {
  @ApiProperty({ example: 'Summer Music Fest — Title Sponsorship' })
  @IsString()
  @MaxLength(200)
  eventName: string;

  @ApiProperty({ example: '2026-12-05T00:00:00.000Z' })
  @IsISO8601()
  eventDate: string;

  @ApiPropertyOptional({ example: '6:00 PM onwards' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  eventTime?: string;

  @ApiProperty({ example: 'Phoenix Marketcity, Bengaluru' })
  @IsString()
  @MaxLength(300)
  venue: string;

  @ApiProperty({ example: 45000 })
  @IsNumber()
  @Min(0)
  finalAmount: number;

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
