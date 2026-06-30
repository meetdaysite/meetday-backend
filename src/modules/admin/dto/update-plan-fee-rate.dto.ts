import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Max, Min } from 'class-validator';

export class UpdatePlanFeeRateDto {
  @ApiProperty({ example: 0.15, description: 'Platform fee rate as a decimal (0–1). E.g. 0.15 = 15%.' })
  @IsNumber()
  @Min(0)
  @Max(1)
  feeRate: number;
}
