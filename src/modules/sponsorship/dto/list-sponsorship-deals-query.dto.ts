import { IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SponsorshipDealStatus } from '@prisma/client';

export class ListSponsorshipDealsQueryDto {
  @ApiPropertyOptional({ enum: SponsorshipDealStatus, description: 'Filter by deal status. Omit to get all.' })
  @IsOptional()
  @IsEnum(SponsorshipDealStatus)
  status?: SponsorshipDealStatus;
}
