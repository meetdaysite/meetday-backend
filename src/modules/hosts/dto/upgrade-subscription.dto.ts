import { IsEnum, IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HostPlan, BillingCycle } from '@prisma/client';

export class UpgradeSubscriptionDto {
  @ApiProperty({ enum: ['SELL', 'COMMUNITY'], description: 'DISCOVER is not a paid plan' })
  @IsEnum(HostPlan)
  @IsIn(['SELL', 'COMMUNITY'], { message: 'Plan must be SELL or COMMUNITY' })
  plan: HostPlan;

  @ApiProperty({ enum: BillingCycle })
  @IsEnum(BillingCycle)
  billingCycle: BillingCycle;

  @ApiPropertyOptional({
    example: 'FOUNDING50',
    description: 'Optional coupon code to apply a discount on the platform fee rate.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9_-]+$/, { message: 'couponCode must be uppercase alphanumeric (A-Z, 0-9, _ -)' })
  couponCode?: string;
}
