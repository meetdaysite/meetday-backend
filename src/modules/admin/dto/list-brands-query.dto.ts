import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { HostApprovalStatus } from '@prisma/client';

export enum BrandProfileStatus {
  COMPLETE = 'COMPLETE',
  INCOMPLETE = 'INCOMPLETE',
}

export class ListBrandsQueryDto {
  @ApiPropertyOptional({ enum: BrandProfileStatus })
  @IsOptional()
  @IsEnum(BrandProfileStatus)
  profileStatus?: BrandProfileStatus;

  @ApiPropertyOptional({ enum: HostApprovalStatus, description: 'Filter by approval status (e.g. PENDING for the review queue).' })
  @IsOptional()
  @IsEnum(HostApprovalStatus)
  approvalStatus?: HostApprovalStatus;

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
