import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateAdminProfileDto {
  @ApiPropertyOptional({
    description: 'GCS object key returned by POST /storage/upload-url with context USER_AVATAR',
    example: 'users/6d01f554-2d4a-41c0-8060-368e510ad0bd/avatar/12abd9a8-02b2-4fa4-8e7a-2e7199163a9f.jpg',
  })
  @IsOptional()
  @IsString()
  avatarKey?: string;

  @ApiPropertyOptional({ description: 'E.164 format, e.g. +919876543210', example: '+919876543210' })
  @IsOptional()
  @Matches(/^\+[1-9]\d{7,14}$/, { message: 'phone must be in E.164 format' })
  phone?: string;

  @ApiPropertyOptional({ minLength: 1, maxLength: 50, example: 'Aishik' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  firstName?: string;

  @ApiPropertyOptional({ minLength: 1, maxLength: 50, example: 'Sikdar' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  lastName?: string;
}
