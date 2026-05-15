import { IsDateString, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateScannerSessionDto {
  @ApiProperty({ example: 'Gate A', maxLength: 100 })
  @IsString()
  @MaxLength(100)
  label: string;

  @ApiProperty({ example: '2026-05-24T23:59:00.000Z', description: 'ISO datetime — when this scanner link expires' })
  @IsDateString()
  expiresAt: string;
}
