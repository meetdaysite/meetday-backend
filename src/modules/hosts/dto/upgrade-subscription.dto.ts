import { IsEnum, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { HostPlan, BillingCycle } from '@prisma/client';

export class UpgradeSubscriptionDto {
  @ApiProperty({ enum: ['SELL', 'COMMUNITY'], description: 'DISCOVER is not a paid plan' })
  @IsEnum(HostPlan)
  @IsIn(['SELL', 'COMMUNITY'], { message: 'Plan must be SELL or COMMUNITY' })
  plan: HostPlan;

  @ApiProperty({ enum: BillingCycle })
  @IsEnum(BillingCycle)
  billingCycle: BillingCycle;
}
