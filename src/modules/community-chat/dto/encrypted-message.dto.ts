import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DmMessageType } from '@prisma/client';

/** Opaque encrypted message payload — the server never decrypts this. */
export class EncryptedMessageDto {
  @ApiProperty({ description: 'base64 AEAD ciphertext (encrypted with the conversation key)' })
  @IsString()
  @MaxLength(100_000)
  ciphertext: string;

  @ApiProperty({ description: 'base64 AEAD nonce' })
  @IsString()
  @MaxLength(512)
  nonce: string;

  @ApiProperty({ description: 'Conversation key epoch this message was encrypted under', default: 1 })
  @IsInt()
  @Min(1)
  keyEpoch: number;

  @ApiPropertyOptional({ enum: DmMessageType, default: DmMessageType.TEXT })
  @IsOptional()
  @IsEnum(DmMessageType)
  messageType?: DmMessageType;

  @ApiPropertyOptional({ description: 'S3 key of the encrypted blob (IMAGE messages)' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  mediaKey?: string;

  @ApiPropertyOptional({ description: 'Encrypted blob size in bytes' })
  @IsOptional()
  @IsInt()
  @Min(0)
  mediaSizeBytes?: number;
}

export class DeviceKeyWrapDto {
  @ApiProperty()
  @IsString()
  recipientUserId: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  recipientDeviceId: string;

  @ApiProperty({ default: 1 })
  @IsInt()
  @Min(1)
  epoch: number;

  @ApiProperty({ description: 'Conversation key sealed to the device public key (opaque base64)' })
  @IsString()
  @MaxLength(8192)
  wrappedKey: string;
}

export class MasterKeyWrapDto {
  @ApiProperty()
  @IsString()
  userId: string;

  @ApiProperty({ default: 1 })
  @IsInt()
  @Min(1)
  epoch: number;

  @ApiProperty({ description: 'Conversation key wrapped to the user master key (opaque base64)' })
  @IsString()
  @MaxLength(8192)
  wrappedKey: string;
}

export class UploadConversationKeysDto {
  @ApiPropertyOptional({ type: [DeviceKeyWrapDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeviceKeyWrapDto)
  deviceWraps?: DeviceKeyWrapDto[];

  @ApiPropertyOptional({ type: [MasterKeyWrapDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MasterKeyWrapDto)
  masterWraps?: MasterKeyWrapDto[];
}
