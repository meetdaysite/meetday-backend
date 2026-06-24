import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsUUID, ValidateNested } from 'class-validator';
import { EncryptedMessageDto, UploadConversationKeysDto } from './encrypted-message.dto';

export class CreateIntroDto {
  @ApiProperty({ description: 'The member to introduce yourself to' })
  @IsUUID()
  targetUserId: string;

  @ApiProperty({ description: 'Encrypted intro message (opaque ciphertext)' })
  @ValidateNested()
  @Type(() => EncryptedMessageDto)
  message: EncryptedMessageDto;

  @ApiProperty({
    description: 'Conversation-key wraps for both participants\' devices (+ optional master wraps)',
    type: UploadConversationKeysDto,
  })
  @ValidateNested()
  @Type(() => UploadConversationKeysDto)
  keys: UploadConversationKeysDto;
}
