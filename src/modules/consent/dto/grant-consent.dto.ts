import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ConsentType } from '@prisma/client';

export class GrantConsentDto {
  @ApiProperty({ enum: ConsentType })
  @IsEnum(ConsentType)
  consentType: ConsentType;
}
