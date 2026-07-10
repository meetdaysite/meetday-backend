import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CommunityAccess } from '@prisma/client';

export enum AudienceSize {
  SMALL = 'SMALL',
  MEDIUM = 'MEDIUM',
  LARGE = 'LARGE',
  VERY_LARGE = 'VERY_LARGE',
}

export enum HostCommunityTab {
  ALL = 'ALL',
  APPROVAL_REQUIRED = 'APPROVAL_REQUIRED',
  INVITE_ONLY = 'INVITE_ONLY',
  MY_COMMUNITIES = 'MY_COMMUNITIES',
  PUBLIC = 'PUBLIC',
}

export class ListHostCommunitiesQueryDto {
  @ApiPropertyOptional({ description: 'Search communities by name (case-insensitive).' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter to communities belonging to this category UUID.' })
  @IsOptional()
  @IsUUID('4')
  categoryId?: string;

  @ApiPropertyOptional({
    example: 'Bangalore',
    description: 'Filter to communities whose primaryCity or communityCities list includes this value.',
  })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({
    enum: AudienceSize,
    description:
      'Filter by member count band. SMALL: <100, MEDIUM: 100–499, LARGE: 500–1999, VERY_LARGE: ≥2000.',
  })
  @IsOptional()
  @IsEnum(AudienceSize)
  audienceSize?: AudienceSize;

  @ApiPropertyOptional({
    enum: CommunityAccess,
    description:
      'Access-type dropdown filter. Applied on the ALL and MY_COMMUNITIES tabs. ' +
      'When tab is PUBLIC, APPROVAL_REQUIRED, or INVITE_ONLY, the tab already constrains access type and this field is ignored.',
  })
  @IsOptional()
  @IsEnum(CommunityAccess)
  access?: CommunityAccess;

  @ApiPropertyOptional({
    enum: HostCommunityTab,
    description:
      'Active tab.\n' +
      '- ALL: all PUBLISHED communities (default).\n' +
      '- PUBLIC: only communities anyone can join.\n' +
      '- APPROVAL_REQUIRED: only communities that require a join request.\n' +
      '- INVITE_ONLY: only communities that require an admin invitation.\n' +
      '- MY_COMMUNITIES: only communities where the calling host is ACTIVE or has a PENDING request.',
  })
  @IsOptional()
  @IsEnum(HostCommunityTab)
  tab?: HostCommunityTab;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
