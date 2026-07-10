import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class AddKeywordAlertDto {
  @ApiProperty({ example: 'scam', minLength: 2, maxLength: 80 })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  keyword: string;

  @ApiPropertyOptional({ description: 'Scope to a channel; omit for all channels' })
  @IsOptional()
  @IsUUID()
  channelId?: string;
}
