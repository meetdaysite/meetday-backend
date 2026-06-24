import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateIntroDto {
  @ApiProperty({ description: 'The member to introduce yourself to' })
  @IsUUID()
  targetUserId: string;

  @ApiProperty({ example: 'Hi Arjun 👋 I noticed we both love Tech House…', maxLength: 250 })
  @IsString()
  @MinLength(1)
  @MaxLength(250)
  message: string;
}
