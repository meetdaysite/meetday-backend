import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsOptional } from 'class-validator';

export class UpdateHostFeePromoDto {
  @ApiPropertyOptional({ example: false, description: 'Set to false to deactivate the promo.' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: '2026-12-31T23:59:59.000Z', description: 'Update the expiry date.' })
  @IsOptional()
  @IsDateString()
  validUntil?: string;
}
