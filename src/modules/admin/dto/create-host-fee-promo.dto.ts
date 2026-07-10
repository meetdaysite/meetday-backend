import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { DiscountType } from '@prisma/client';

export class CreateHostFeePromoDto {
  @ApiProperty({ enum: DiscountType, example: DiscountType.PERCENTAGE })
  @IsEnum(DiscountType)
  discountType: DiscountType;

  @ApiProperty({
    example: 50,
    description: 'Discount magnitude. For PERCENTAGE: 0–100 (e.g. 50 = 50% off). For FLAT: absolute reduction in fee rate percentage points.',
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  discountValue: number;

  @ApiPropertyOptional({ example: '2026-07-01T00:00:00.000Z', description: 'When the promo becomes active.' })
  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-01T00:00:00.000Z', description: 'When the promo expires.' })
  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @ApiPropertyOptional({ example: 5, description: 'Max number of unique events this promo applies to. Null = unlimited.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxEvents?: number;
}
