import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CouponTarget, DiscountType } from '@prisma/client';

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

export class CreateCouponDto {
  @ApiProperty({
    description: 'Uppercase alphanumeric code (A-Z, 0-9, _ -). 3–30 chars.',
    example: 'FOUNDING50',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[A-Z0-9_-]+$/, { message: 'code must be uppercase alphanumeric (A-Z, 0-9, _ -)' })
  code: string;

  @ApiPropertyOptional({ example: '50% off platform fee for founding hosts' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: CouponTarget, description: 'Who can redeem this coupon' })
  @IsEnum(CouponTarget)
  target: CouponTarget;

  @ApiProperty({
    enum: DiscountType,
    description:
      'PERCENTAGE: reduce fee rate by X% of its value (e.g. 50% off 15% → 7.5%). ' +
      'FLAT: reduce fee rate by X percentage points (e.g. 10 off 15% → 5%).',
  })
  @IsEnum(DiscountType)
  discountType: DiscountType;

  @ApiProperty({ example: 50, description: 'Discount magnitude — percentage (0–100) or flat points (no upper limit)' })
  @IsNumber()
  @Min(0.01)
  @MaxIfPercentage()
  discountValue: number;

  @ApiPropertyOptional({ example: 100, description: 'Max total redemptions across all users. Omit for unlimited.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUsages?: number;

  @ApiPropertyOptional({ example: 1, description: 'Max redemptions per user. Omit for unlimited.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUsagesPerUser?: number;

  @ApiPropertyOptional({ example: '2026-04-14T00:00:00.000Z', description: 'Coupon becomes valid from this date.' })
  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @ApiPropertyOptional({ example: '2026-12-31T23:59:59.000Z', description: 'Coupon expires after this date.' })
  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @ApiPropertyOptional({
    example: 'event-uuid',
    description:
      'Restrict this coupon to a specific event. Only valid when target is ATTENDEE. ' +
      'Omit for a platform-wide code usable on any event.',
  })
  @IsOptional()
  @IsUUID('4')
  eventId?: string;
}
