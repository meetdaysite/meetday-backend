import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export enum MemberFilter {
  ALL = 'all',
  ONLINE = 'online',
  NEW = 'new',
  ACTIVE = 'active',
  ATTENDED = 'attended',
  HOSTS = 'hosts',
}

export enum MemberSort {
  RECENTLY_ACTIVE = 'recentlyActive',
  NEWEST = 'newest',
  MOST_ACTIVE = 'mostActive',
  ALPHABETICAL = 'alphabetical',
}

export class ListMembersQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Case-insensitive match on name or city' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: MemberFilter, default: MemberFilter.ALL })
  @IsOptional()
  @IsEnum(MemberFilter)
  filter?: MemberFilter;

  @ApiPropertyOptional({ enum: MemberSort, default: MemberSort.RECENTLY_ACTIVE })
  @IsOptional()
  @IsEnum(MemberSort)
  sort?: MemberSort;
}
