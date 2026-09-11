import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
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

  @ApiPropertyOptional({ description: 'UUID of a message in the same thread being replied to.' })
  @IsOptional()
  @IsUUID()
  replyToId?: string;

  @ApiPropertyOptional({
    enum: ['BRAND', 'COMMUNITY', 'SPACE'],
    description:
      'Which dashboard this message was sent from — only needed to disambiguate the rare case ' +
      'where the same account owns both the space and the requesting brand/community profile.',
  })
  @IsOptional()
  @IsEnum(['BRAND', 'COMMUNITY', 'SPACE'])
  asRole?: 'BRAND' | 'COMMUNITY' | 'SPACE';
}
