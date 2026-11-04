import { IsIn, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class MarkBrandCommunityInterestDto {
  @ApiPropertyOptional({
    enum: ['SPONSORSHIP', 'BRANDED_CONTENT', 'SAMPLING'],
    default: 'SPONSORSHIP',
    description: 'Specific interest domain from the brand',
  })
  @IsOptional()
  @IsString()
  @IsIn(['SPONSORSHIP', 'BRANDED_CONTENT', 'SAMPLING'])
  domain?: 'SPONSORSHIP' | 'BRANDED_CONTENT' | 'SAMPLING';
}
