import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateChatMessageDto {
  @ApiProperty({ example: 'Updated message text' })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content: string;
}
