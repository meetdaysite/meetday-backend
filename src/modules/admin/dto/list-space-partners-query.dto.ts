import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListSpacePartnersQueryDto {
  @ApiPropertyOptional({ description: 'Filter by business name, email, or contact name (case-insensitive contains)' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by operating city (case-insensitive contains, matches any city in the array)' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({
    enum: ['ALL', 'PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'NOT_ACTIVATED'],
    description: 'Filter by the space partner\'s Community Space Profile approval status. NOT_ACTIVATED means no profile has been created yet.',
  })
  @IsOptional()
  @IsIn(['ALL', 'PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'NOT_ACTIVATED'])
  profileStatus?: 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED' | 'NOT_ACTIVATED';

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
  limit?: number = 20;
}
