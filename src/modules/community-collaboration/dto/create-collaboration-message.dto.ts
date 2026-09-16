import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'

export class CreateCollaborationMessageDto {
  @ApiPropertyOptional({ example: 'Hello, let us collaborate!' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  content?: string

  @ApiPropertyOptional({ description: 'S3/storage object key of an attached image' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  mediaKey?: string

  @ApiPropertyOptional({ description: 'UUID of the message being replied to' })
  @IsOptional()
  @IsUUID()
  replyToId?: string
}
