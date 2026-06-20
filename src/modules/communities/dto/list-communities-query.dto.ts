import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CommunityStatus } from '@prisma/client';

export class ListCommunitiesQueryDto {
  @ApiPropertyOptional({ enum: CommunityStatus, description: 'Admin list only — filter by status.' })
  @IsOptional()
  @IsEnum(CommunityStatus)
  status?: CommunityStatus;

  @ApiPropertyOptional({ example: 'Kolkata' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ description: 'Category UUID' })
  @IsOptional()
  @IsUUID('4')
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Search in community name.' })
  @IsOptional()
  @IsString()
  search?: string;

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
