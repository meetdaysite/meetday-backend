import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SendSpaceHostChatMessageDto {
  @ApiPropertyOptional({ example: "Hi, we'd love to partner with your community for our next pop-up!" })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  content?: string;

  @ApiPropertyOptional({
    description: 'GCS object key of an attached image, from POST /storage/upload-url (context SPACE_HOST_CHAT_MEDIA).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  mediaKey?: string;

  @ApiPropertyOptional({ description: 'UUID of a message in the same thread being replied to.' })
  @IsOptional()
  @IsUUID()
  replyToId?: string;

  @ApiPropertyOptional({
    enum: ['HOST', 'SPACE'],
    description: 'Which dashboard this message was sent from — only needed to disambiguate a dual-profile account.',
  })
  @IsOptional()
  @IsEnum(['HOST', 'SPACE'])
  asRole?: 'HOST' | 'SPACE';
}
