import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class KycWebhookDto {
  @ApiProperty({ description: 'Reference ID returned by the KYC provider when verification was initiated', example: 'KYC-STUB-a1b2c3d4' })
  @IsString()
  referenceId: string;

  @ApiProperty({ description: 'UUID of the HostProfile being verified', example: 'hp-uuid-1234' })
  @IsUUID('4')
  hostProfileId: string;

  @ApiProperty({ enum: ['VERIFIED', 'FAILED'], description: 'Outcome of the KYC verification' })
  @IsIn(['VERIFIED', 'FAILED'])
  status: 'VERIFIED' | 'FAILED';

  @ApiPropertyOptional({ description: 'Reason for failure — required when status is FAILED', example: 'Document image unclear' })
  @IsOptional()
  @IsString()
  failureReason?: string;

  @ApiPropertyOptional({
    description: 'Masked Aadhaar provided by the KYC provider on successful verification. Only last 4 digits visible. Stored as-is — full number is never stored.',
    example: 'XXXX XXXX 1234',
  })
  @IsOptional()
  @IsString()
  maskedAadhaar?: string;
}
