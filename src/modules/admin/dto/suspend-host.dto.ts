import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SuspendHostDto {
  @ApiProperty({ minLength: 10, maxLength: 500, example: 'Multiple reports of fraudulent event listings.' })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}
