import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class RequestSpaceHostDealChangesDto {
  @ApiPropertyOptional({ description: 'Note explaining what changes are needed.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @ApiPropertyOptional({
    enum: ['HOST', 'SPACE'],
    description: 'Which dashboard this was submitted from — only needed for accounts that own both a Host and Space profile.',
  })
  @IsOptional()
  @IsEnum(['HOST', 'SPACE'])
  asRole?: 'HOST' | 'SPACE';
}
