import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CancelEventDto {
  @ApiProperty({ minLength: 10, maxLength: 500, example: 'Venue became unavailable due to unforeseen circumstances.' })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  cancellationReason: string;
}
