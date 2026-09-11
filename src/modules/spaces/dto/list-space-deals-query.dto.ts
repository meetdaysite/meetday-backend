import { IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SpaceDealStatus } from '@prisma/client';

export class ListSpaceDealsQueryDto {
  @ApiPropertyOptional({ enum: SpaceDealStatus, description: 'Filter by deal status. Omit to get all.' })
  @IsOptional()
  @IsEnum(SpaceDealStatus)
  status?: SpaceDealStatus;
}
