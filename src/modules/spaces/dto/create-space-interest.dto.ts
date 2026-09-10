import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSpaceInterestDto {
  @ApiPropertyOptional({ description: 'Optional note sent along with the interest request.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}
