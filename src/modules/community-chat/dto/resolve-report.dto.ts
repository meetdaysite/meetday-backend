import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { ReportAction } from '@prisma/client';

export class ResolveReportDto {
  @ApiProperty({ enum: ReportAction })
  @IsEnum(ReportAction)
  action: ReportAction;
}
