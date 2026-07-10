import { IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum DashboardPeriod {
  THIS_MONTH = 'THIS_MONTH',
  LAST_30_DAYS = 'LAST_30_DAYS',
  THIS_YEAR = 'THIS_YEAR',
  ALL_TIME = 'ALL_TIME',
}

export class DashboardQueryDto {
  @ApiPropertyOptional({
    enum: DashboardPeriod,
    default: DashboardPeriod.THIS_MONTH,
    description: 'Time window for the overview stats and their % deltas.',
  })
  @IsOptional()
  @IsEnum(DashboardPeriod)
  period: DashboardPeriod = DashboardPeriod.THIS_MONTH;
}
