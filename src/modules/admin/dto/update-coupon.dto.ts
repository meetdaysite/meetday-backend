import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { DiscountType } from '@prisma/client';

function MaxIfPercentage(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'maxIfPercentage',
      target: (object as any).constructor,
      propertyName,
      options: {
        message: 'discountValue must not exceed 100 when discountType is PERCENTAGE',
        ...validationOptions,
      },
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const obj = args.object as { discountType?: DiscountType };
          if (obj.discountType === DiscountType.PERCENTAGE) {
            return typeof value === 'number' && value <= 100;
          }
          return true;
        },
      },
    });
  };
}

export class UpdateCouponDto {
  @ApiPropertyOptional({ example: 'Updated description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: DiscountType })
  @IsOptional()
  @IsEnum(DiscountType)
  discountType?: DiscountType;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @MaxIfPercentage()
  discountValue?: number;

  @ApiPropertyOptional({ example: 500, description: 'New total redemption cap. Must not be below current usageCount.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUsages?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUsagesPerUser?: number;

  @ApiPropertyOptional({ example: 500, description: 'Minimum order subtotal (₹) required to apply this coupon.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minOrderValue?: number;

  @ApiPropertyOptional({ example: 200, description: 'Absolute cap on the discount amount (₹).' })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  maxDiscountAmount?: number;

  @ApiPropertyOptional({ example: '2026-04-14T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @ApiPropertyOptional({ example: '2027-12-31T23:59:59.000Z' })
  @IsOptional()
  @IsDateString()
  validUntil?: string;
}
