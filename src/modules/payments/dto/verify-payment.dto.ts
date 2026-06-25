import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID } from 'class-validator';

export class VerifyPaymentDto {
  @ApiProperty({ example: 'order_xxxxxxxxxxxxx', description: 'Razorpay order ID returned by POST /payments/initiate' })
  @IsString()
  razorpayOrderId: string;

  @ApiProperty({ example: 'pay_xxxxxxxxxxxxx', description: 'Payment ID received in Razorpay checkout success callback' })
  @IsString()
  razorpayPaymentId: string;

  @ApiProperty({ example: '9ef4dffbfd84f1318f6739a3ce19f9d85851857ae6971425082d0f894a15d484', description: 'Signature received in Razorpay checkout success callback' })
  @IsString()
  razorpaySignature: string;

  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', description: 'Internal order ID for which payment was initiated' })
  @IsUUID('4')
  internalOrderId: string;
}
