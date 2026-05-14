import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ConsentType } from '@prisma/client';

export class GrantConsentDto {
  @ApiProperty({ enum: ConsentType })
  @IsEnum(ConsentType)
  consentType: ConsentType;

  @ApiProperty({ description: 'Policy version shown to the user e.g. "tos-v1.2"' })
  @IsString()
  @IsNotEmpty()
  version: string;

  @ApiProperty({ description: 'Snapshot of the consent statement shown to the user' })
  @IsString()
  @IsNotEmpty()
  consentText: string;
}
