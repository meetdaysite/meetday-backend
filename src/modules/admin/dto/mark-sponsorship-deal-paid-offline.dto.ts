import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsNumber, IsOptional, Min } from 'class-validator';

export class MarkSponsorshipDealPaidOfflineDto {
  @ApiPropertyOptional({ example: 0, description: 'Transaction fee to record for this offline payment. Defaults to 0.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  transactionFeeAmount?: number;

  @ApiPropertyOptional({ description: 'Transaction date & time to record. Defaults to now.' })
  @IsOptional()
  @IsISO8601()
  paidAt?: string;
}
