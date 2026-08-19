import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class RequestDealChangesDto {
  @ApiPropertyOptional({ example: 'Can we revisit the final amount and add a booth deliverable?' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
