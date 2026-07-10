import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Max, Min } from 'class-validator';

export class UpdateGstRateDto {
  @ApiProperty({ example: 0.18, description: 'GST rate as a decimal (0–1). E.g. 0.18 = 18%.' })
  @IsNumber()
  @Min(0)
  @Max(1)
  gstRate: number;
}
