import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateInterestDto {
  @ApiProperty({ example: "Founder's Huddle", maxLength: 100 })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'For startup founders and entrepreneurs building the next big thing', maxLength: 400 })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  description?: string;

  @ApiPropertyOptional({ description: 'S3 key or public URL for the interest cover image', example: 'interests/founders-huddle.jpg' })
  @IsOptional()
  @IsString()
  image?: string;
}
