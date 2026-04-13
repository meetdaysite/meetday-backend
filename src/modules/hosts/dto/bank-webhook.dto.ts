import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BankWebhookDto {
  @ApiProperty({
    description: 'Razorpay penny drop reference ID',
    example: 'penny_abc123xyz',
  })
  @IsString()
  pennyDropReference: string;

  @ApiProperty({
    description: 'UUID of the HostPayoutAccount being verified',
    example: 'payout-uuid-1234',
  })
  @IsUUID('4')
  hostPayoutAccountId: string;

  @ApiProperty({ enum: ['SUCCESS', 'FAILED'], description: 'Outcome of the penny drop verification' })
  @IsIn(['SUCCESS', 'FAILED'])
  status: 'SUCCESS' | 'FAILED';

  @ApiPropertyOptional({
    description: 'Bank name returned by Razorpay on successful penny drop',
    example: 'HDFC Bank',
  })
  @IsOptional()
  @IsString()
  bankName?: string;

  @ApiPropertyOptional({
    description: 'Failure reason — provided when status is FAILED',
    example: 'Account not found',
  })
  @IsOptional()
  @IsString()
  failureReason?: string;
}
