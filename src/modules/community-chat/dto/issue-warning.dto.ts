import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class IssueWarningDto {
  @ApiProperty({ description: 'User to warn' })
  @IsUUID()
  userId: string;

  @ApiPropertyOptional({ description: 'Message that prompted the warning' })
  @IsOptional()
  @IsUUID()
  messageId?: string;

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  reason: string;

  @ApiPropertyOptional({ description: 'ISO 8601 datetime; omit for no expiry' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
