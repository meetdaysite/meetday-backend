import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsISO8601, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { CommunityRole } from '@prisma/client';

export const ADMIN_MEMBER_STATUS_FILTERS = ['ALL', 'ACTIVE', 'NEW', 'INACTIVE', 'BANNED'] as const;
export type AdminMemberStatusFilter = (typeof ADMIN_MEMBER_STATUS_FILTERS)[number];

export const ADMIN_MEMBER_SORTS = ['RECENTLY_JOINED', 'LAST_ACTIVE', 'ENGAGEMENT', 'ALPHABETICAL'] as const;
export type AdminMemberSort = (typeof ADMIN_MEMBER_SORTS)[number];

export class AdminListMembersQueryDto {
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
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ enum: ADMIN_MEMBER_STATUS_FILTERS, default: 'ALL' })
  @IsOptional()
  @IsEnum(ADMIN_MEMBER_STATUS_FILTERS)
  status?: AdminMemberStatusFilter = 'ALL';

  @ApiPropertyOptional({ enum: CommunityRole })
  @IsOptional()
  @IsEnum(CommunityRole)
  role?: CommunityRole;

  @ApiPropertyOptional({ enum: ADMIN_MEMBER_SORTS, default: 'RECENTLY_JOINED' })
  @IsOptional()
  @IsEnum(ADMIN_MEMBER_SORTS)
  sort?: AdminMemberSort = 'RECENTLY_JOINED';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class GenerateInviteDto {
  @ApiPropertyOptional({ description: 'Days until the invite expires. Omit for no expiry.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expiresInDays?: number;

  @ApiPropertyOptional({ description: 'Maximum number of uses. Omit for unlimited.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxUses?: number;
}
