import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { HostApprovalStatus, HostPlan, KycStatus } from '@prisma/client';

export class ListHostsQueryDto {
  @ApiPropertyOptional({ enum: HostApprovalStatus })
  @IsOptional()
  @IsEnum(HostApprovalStatus)
  approvalStatus?: HostApprovalStatus;

  @ApiPropertyOptional({ enum: KycStatus })
  @IsOptional()
  @IsEnum(KycStatus)
  kycStatus?: KycStatus;

  @ApiPropertyOptional({ enum: HostPlan })
  @IsOptional()
  @IsEnum(HostPlan)
  plan?: HostPlan;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
