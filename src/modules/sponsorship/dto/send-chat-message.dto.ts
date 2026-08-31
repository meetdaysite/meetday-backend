import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
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

  @ApiPropertyOptional({ description: 'UUID of a message in the same thread being replied to.' })
  @IsOptional()
  @IsUUID()
  replyToId?: string;

  @ApiPropertyOptional({
    enum: ['HOST', 'BRAND'],
    description:
      'Which "hat" you are sending as — only needed to disambiguate the rare case where the same ' +
      'account owns both the host and brand profile on this interest (self-interest). Ignored otherwise.',
  })
  @IsOptional()
  @IsEnum(['HOST', 'BRAND'])
  asRole?: 'HOST' | 'BRAND';
}
