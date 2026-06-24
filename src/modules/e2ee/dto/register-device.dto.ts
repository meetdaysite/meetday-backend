import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDeviceDto {
  @ApiProperty({ description: 'Client-generated stable device id' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  deviceId: string;

  @ApiProperty({ description: 'base64 X25519 identity public key' })
  @IsString()
  @MaxLength(512)
  identityPublicKey: string;

  @ApiPropertyOptional({ description: 'base64 Ed25519 signing public key' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  signingPublicKey?: string;

  @ApiPropertyOptional({ example: 'Chrome on Mac' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;
}
