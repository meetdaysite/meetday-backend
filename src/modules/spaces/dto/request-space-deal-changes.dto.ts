import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class RequestSpaceDealChangesDto {
  @ApiPropertyOptional({ description: 'Note explaining what changes are needed.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
