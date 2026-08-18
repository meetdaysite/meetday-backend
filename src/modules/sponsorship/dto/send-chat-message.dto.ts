import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendChatMessageDto {
  @ApiProperty({ example: "Hi, we'd love to sponsor your next event!" })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content: string;
}
