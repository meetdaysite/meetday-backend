import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class AddBlockedLinkDto {
  @ApiProperty({ example: 'bit.ly', description: 'Domain or URL pattern to block' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  pattern: string;
}
