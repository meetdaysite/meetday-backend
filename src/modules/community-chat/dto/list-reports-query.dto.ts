import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { MessageReportStatus } from '@prisma/client';

export class ListReportsQueryDto {
  @ApiPropertyOptional({ enum: MessageReportStatus, default: 'PENDING' })
  @IsOptional()
  @IsEnum(MessageReportStatus)
  status?: MessageReportStatus = MessageReportStatus.PENDING;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}
