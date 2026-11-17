import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSpaceInterestDto {
  @ApiPropertyOptional({ description: 'Optional note sent along with the interest request.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;

  @ApiPropertyOptional({
    enum: ['BRAND', 'COMMUNITY'],
    description:
      'Which dashboard this request was sent from — only needed to disambiguate the rare case ' +
      'where the same account has both a Brand and a Community profile. Ignored otherwise.',
  })
  @IsOptional()
  @IsEnum(['BRAND', 'COMMUNITY'])
  asRole?: 'BRAND' | 'COMMUNITY';

  @ApiPropertyOptional({
    enum: ['NAMING_RIGHTS', 'PHYSICAL_BRANDING', 'SAMPLING_DEMO', 'POPUPS_EXPERIENCES'],
    description: 'Specific interest type from the brand',
  })
  @IsOptional()
  @IsString()
  @IsIn(['NAMING_RIGHTS', 'PHYSICAL_BRANDING', 'SAMPLING_DEMO', 'POPUPS_EXPERIENCES'])
  interestType?: 'NAMING_RIGHTS' | 'PHYSICAL_BRANDING' | 'SAMPLING_DEMO' | 'POPUPS_EXPERIENCES';
}
