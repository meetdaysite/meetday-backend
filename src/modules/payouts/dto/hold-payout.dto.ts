import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class HoldPayoutDto {
  @ApiProperty({ description: 'Reason for placing the payout on hold', maxLength: 500 })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}
