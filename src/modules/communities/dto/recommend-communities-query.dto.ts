import { ApiHideProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { CommunityStatus } from '@prisma/client';
import { ListCommunitiesQueryDto } from './list-communities-query.dto';

export class RecommendCommunitiesQueryDto extends ListCommunitiesQueryDto {
  // status is an admin-only filter on the list endpoint; it has no effect here
  // (this endpoint always returns PUBLISHED communities). Hide it from Swagger.
  @ApiHideProperty()
  @IsOptional()
  @IsEnum(CommunityStatus)
  override status?: CommunityStatus;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Interest UUIDs used for ranking when the request is unauthenticated. ' +
      'Repeat the param for multiple values: ?interestIds=<uuid1>&interestIds=<uuid2>. ' +
      'Ignored when a valid Bearer token is supplied — stored LIKED/OPEN_TO affinities are used instead.',
    example: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'],
  })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(50)
  interestIds?: string[];
}
