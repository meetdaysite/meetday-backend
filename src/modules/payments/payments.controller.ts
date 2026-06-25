import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { PaymentsService } from './payments.service';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { VerifyPaymentDto } from './dto/verify-payment.dto';

@ApiTags('Payments')
@ApiBearerAuth('firebase-token')
@UseGuards(RolesGuard)
@Roles('USER')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('initiate')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a Razorpay order for an existing internal order',
    description:
      'Calls the Razorpay API to create a payment order. Returns the razorpayOrderId, amount, currency, and keyId needed to open the Razorpay checkout modal. Idempotent: calling again for the same orderId returns the existing Razorpay order.',
  })
  @ApiCreatedResponse({ description: 'Razorpay order created. Returns { razorpayOrderId, amount, currency, keyId }.' })
  @ApiBadRequestResponse({ description: 'Order is not in PENDING_PAYMENT status, or amount below minimum (100 paise).' })
  @ApiForbiddenResponse({ description: 'Order belongs to a different user.' })
  @ApiNotFoundResponse({ description: 'Internal order not found.' })
  initiatePayment(@GetUser('id') userId: string, @Body() dto: InitiatePaymentDto) {
    return this.paymentsService.initiatePayment(userId, dto);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify Razorpay payment signature and confirm order',
    description:
      'Verifies the HMAC-SHA256 signature returned by the Razorpay checkout. On success: marks the order CONFIRMED, stores razorpayPaymentId, fires confirmation email, notifications, and audit log.',
  })
  @ApiOkResponse({ description: 'Payment verified. Order is now CONFIRMED.' })
  @ApiUnauthorizedResponse({ description: 'Invalid payment signature.' })
  @ApiBadRequestResponse({ description: 'razorpayOrderId mismatch or order not in PENDING_PAYMENT status.' })
  @ApiForbiddenResponse({ description: 'Order belongs to a different user.' })
  @ApiNotFoundResponse({ description: 'Order not found.' })
  verifyPayment(@GetUser('id') userId: string, @Body() dto: VerifyPaymentDto) {
    return this.paymentsService.verifyPayment(userId, dto);
  }
}
