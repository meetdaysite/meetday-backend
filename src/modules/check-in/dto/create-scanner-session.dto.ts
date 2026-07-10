import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateScannerSessionDto {
  @ApiProperty({ example: 'Rahul Sharma', maxLength: 100, description: "Staff member's full name" })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'rahul@example.com', description: "Staff member's email — scanner link will be sent here" })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ example: '+919876543210', maxLength: 20, description: "Staff member's phone number" })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ example: 'Gate A', maxLength: 100, description: 'Optional positional label e.g. "Gate A", "VIP Entrance"' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;
}
