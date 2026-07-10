import { IsArray, IsEmail, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InviteAdminDto {
  @ApiProperty({ example: 'citymanager@meetday.in', description: 'Email address of the admin to invite.' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Aishik', minLength: 1, maxLength: 50 })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  firstName: string;

  @ApiProperty({ example: 'Sikdar', minLength: 1, maxLength: 50 })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  lastName: string;

  @ApiProperty({
    example: 'a3f2c1d4-0000-0000-0000-000000000001',
    description:
      'UUID of the role to assign. Fetch available roles from GET /admin/roles?adminOnly=true. ' +
      'SUPER_ADMIN cannot be granted via this endpoint.',
  })
  @IsUUID('4')
  roleId: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['Mumbai', 'Pune'],
    description: 'Required when role is CITY_ADMIN. Cities this admin will manage.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  managedCities?: string[];
}
