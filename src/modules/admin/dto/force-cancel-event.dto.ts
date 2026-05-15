import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ForceCancelEventDto {
  @ApiProperty({ minLength: 10, maxLength: 500, example: 'Event violates platform safety guidelines.' })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}
