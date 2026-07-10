import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class InitiatePaymentDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', description: 'Internal order ID returned by POST /orders' })
  @IsUUID('4')
  orderId: string;
}
