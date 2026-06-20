import { IsArray, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SetCommunityCitiesDto {
  @ApiPropertyOptional({ example: 'Kolkata', description: 'Primary city shown on the community.' })
  @IsOptional()
  @IsString()
  primaryCity?: string;

  @ApiProperty({
    type: [String],
    example: ['Kolkata', 'Mumbai', 'Delhi'],
    description: 'Cities where this community is relevant. Replaces the full set.',
  })
  @IsArray()
  @IsString({ each: true })
  communityCities: string[];
}
