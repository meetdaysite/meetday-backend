import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateFcmTokenDto {
  @ApiProperty({
    description: 'Firebase Cloud Messaging token for push notifications',
    example: 'eUm5X9dIL4o:APA91b...',
  })
  @IsNotEmpty()
  @IsString()
  fcmToken: string;
}
