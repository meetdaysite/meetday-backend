import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

// Submitted by the host once a deal is APPROVED/locked — describes what deliverables were
// actually completed. Exact fields may expand later; kept intentionally simple for now.
export class UpsertSponsorshipDealReportDto {
  @ApiProperty({ example: 'Set up a branded booth at the entrance and ran 3 Instagram stories.' })
  @IsString()
  @MaxLength(4000)
  summary: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Up to 6 GCS object keys from POST /storage/upload-url (SPONSORSHIP_DEAL_REPORT_MEDIA context)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  proofKeys?: string[];

  @ApiPropertyOptional({ example: 'Footfall was higher than expected, brand rep was on-site for the full event.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
