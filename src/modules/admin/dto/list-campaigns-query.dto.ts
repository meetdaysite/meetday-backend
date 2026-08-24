import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SponsorshipStatus } from '@prisma/client';

export class ListCampaignsQueryDto {
  @ApiPropertyOptional({ enum: SponsorshipStatus })
  @IsOptional()
  @IsEnum(SponsorshipStatus)
  status?: SponsorshipStatus;

  @ApiPropertyOptional({ example: 'Mumbai' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'bp-uuid' })
  @IsOptional()
  @IsUUID('4')
  brandProfileId?: string;

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
