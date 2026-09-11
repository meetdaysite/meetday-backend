import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class RequestSpaceDealChangesDto {
  @ApiPropertyOptional({ description: 'Note explaining what changes are needed.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @ApiPropertyOptional({
    enum: ['BRAND', 'COMMUNITY', 'SPACE'],
    description: 'Which dashboard this was submitted from — only needed for accounts that own both the space and requester profile.',
  })
  @IsOptional()
  @IsEnum(['BRAND', 'COMMUNITY', 'SPACE'])
  asRole?: 'BRAND' | 'COMMUNITY' | 'SPACE';
}
