import { IsEnum, IsInt, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MediaType } from '@prisma/client';

export class ConfirmMediaUploadDto {
  @ApiProperty({ example: 'events/event-uuid/cover/abc123.jpg' })
  @IsString()
  key: string;

  @ApiProperty({ enum: MediaType, example: 'COVER' })
  @IsEnum(MediaType)
  type: MediaType;

  @ApiPropertyOptional({ default: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  order?: number = 0;
}
