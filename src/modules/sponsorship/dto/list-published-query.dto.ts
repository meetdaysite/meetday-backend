import { IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListPublishedQueryDto {
  @ApiPropertyOptional({
    description: 'Filter to proposals whose host community profile is tagged with this category. Omit for all.',
  })
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}
