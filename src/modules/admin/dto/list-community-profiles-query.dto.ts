import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { HostApprovalStatus } from '@prisma/client';

export class ListCommunityProfilesQueryDto {
  @ApiPropertyOptional({ enum: HostApprovalStatus })
  @IsOptional()
  @IsEnum(HostApprovalStatus)
  status?: HostApprovalStatus;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}
