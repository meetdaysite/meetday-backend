import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class MuteUserDto {
  @ApiProperty({ description: 'User to mute' })
  @IsUUID()
  userId: string;

  @ApiPropertyOptional({ description: 'Scope to a specific channel; omit for community-wide mute' })
  @IsOptional()
  @IsUUID()
  channelId?: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 datetime; omit for permanent mute' })
  @IsOptional()
  @IsDateString()
  mutedUntil?: string;
}
