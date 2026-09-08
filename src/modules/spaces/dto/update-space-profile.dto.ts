import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateSpaceProfileDto {
  @ApiPropertyOptional({
    maxLength: 150,
    example: 'WeWork India',
    description: 'Business or Venue Chain Name',
  })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  businessName?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['Delhi', 'Gurugram', 'Bengaluru'],
    description: 'Operating cities',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  operatingCities?: string[];

  @ApiPropertyOptional({
    example: '+919876543210',
    description: 'Contact phone number',
  })
  @IsOptional()
  @IsString()
  phone?: string;
}
