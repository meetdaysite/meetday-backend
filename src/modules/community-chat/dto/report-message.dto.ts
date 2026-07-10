import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { MessageReportReason } from '@prisma/client';

export class ReportMessageDto {
  @ApiProperty({ enum: MessageReportReason })
  @IsEnum(MessageReportReason)
  reason: MessageReportReason;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  body?: string;
}
