import { PartialType } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CreateAttendeeProfileDto } from './create-attendee-profile.dto';

export class UpdateAttendeeProfileDto extends PartialType(CreateAttendeeProfileDto) {
  @ApiPropertyOptional({
    description: 'GCS object key returned by POST /storage/upload-url with context USER_AVATAR',
    example: 'users/6d01f554-2d4a-41c0-8060-368e510ad0bd/avatar/12abd9a8-02b2-4fa4-8e7a-2e7199163a9f.jpg',
  })
  @IsOptional()
  @IsString()
  avatarKey?: string;
}
