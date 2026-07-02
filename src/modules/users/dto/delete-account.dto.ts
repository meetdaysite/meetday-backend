import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DeleteAccountDto {
  @ApiPropertyOptional({
    description: 'Optional reason for account deletion (stored in audit log for DPDP compliance)',
    maxLength: 500,
    example: 'No longer using the app',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
