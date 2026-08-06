import { IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SponsorshipStatus } from '@prisma/client';

export class ListProposalsQueryDto {
  @ApiPropertyOptional({ enum: SponsorshipStatus, description: 'Filter by status. Omit to return all statuses.' })
  @IsOptional()
  @IsEnum(SponsorshipStatus)
  status?: SponsorshipStatus;
}
