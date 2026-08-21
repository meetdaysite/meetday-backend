import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class VerifySponsorshipDealPaymentDto {
  @ApiProperty({ example: 'order_xxxxxxxxxxxxx', description: 'Razorpay order ID returned by the initiate-payment endpoint' })
  @IsString()
  razorpayOrderId: string;

  @ApiProperty({ example: 'pay_xxxxxxxxxxxxx', description: 'Payment ID received in the Razorpay checkout success callback' })
  @IsString()
  razorpayPaymentId: string;

  @ApiProperty({ example: '9ef4dffbfd84f1318f6739a3ce19f9d85851857ae6971425082d0f894a15d484', description: 'Signature received in the Razorpay checkout success callback' })
  @IsString()
  razorpaySignature: string;
}
