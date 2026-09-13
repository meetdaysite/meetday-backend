import { IsEnum, IsOptional, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SponsorshipStatus } from '@prisma/client';

export class ListProposalsQueryDto {
  @ApiPropertyOptional({ enum: SponsorshipStatus, description: 'Filter by status. Omit to return all statuses.' })
  @IsOptional()
  @IsEnum(SponsorshipStatus)
  status?: SponsorshipStatus;

  @ApiPropertyOptional({
    enum: ['HOST', 'SPACE'],
    description:
      'Disambiguates which profile to act as when the same account has both a Host and a Space ' +
      'Partner profile — the frontend knows which dashboard it is calling from, the backend cannot ' +
      'infer it from the account alone in that case.',
  })
  @IsOptional()
  @IsIn(['HOST', 'SPACE'])
  actorType?: 'HOST' | 'SPACE';
}
