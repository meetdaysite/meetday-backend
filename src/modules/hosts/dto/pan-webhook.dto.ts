import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PanWebhookDto {
  @ApiProperty({
    description: 'Reference ID returned by the KYC provider when PAN verification was initiated',
    example: 'KYC-PAN-a1b2c3d4',
  })
  @IsString()
  referenceId: string;

  @ApiProperty({ description: 'UUID of the HostProfile being verified', example: 'hp-uuid-1234' })
  @IsUUID('4')
  hostProfileId: string;

  @ApiProperty({ enum: ['VERIFIED', 'FAILED'], description: 'Outcome of PAN verification' })
  @IsIn(['VERIFIED', 'FAILED'])
  status: 'VERIFIED' | 'FAILED';

  @ApiPropertyOptional({
    description: 'Reason for failure — provided when status is FAILED',
    example: 'PAN not found in ITD database',
  })
  @IsOptional()
  @IsString()
  failureReason?: string;
}
