import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SendChatMessageDto {
  @ApiPropertyOptional({ example: "Hi, we'd love to sponsor your next event!" })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  content?: string;

  @ApiPropertyOptional({
    description: 'GCS object key of an attached image, from POST /storage/upload-url (context SPONSORSHIP_CHAT_MEDIA).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  mediaKey?: string;
}
