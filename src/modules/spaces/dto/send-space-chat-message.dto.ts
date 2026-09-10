import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SendSpaceChatMessageDto {
  @ApiPropertyOptional({ example: "Hi, we'd love to host our next meetup at your space!" })
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
