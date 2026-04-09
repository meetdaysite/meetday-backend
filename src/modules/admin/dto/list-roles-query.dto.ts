import { IsBoolean, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListRolesQueryDto {
  @ApiPropertyOptional({
    description:
      'When true, excludes USER, HOST, and SUPER_ADMIN — returns only invitable admin roles (CITY_ADMIN, MODERATOR, SUPPORT). ' +
      'Use this to populate the role dropdown on the invite admin form.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  adminOnly?: boolean;
}
