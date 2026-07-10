import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { VerifyPaymentDto } from './dto/verify-payment.dto';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Razorpay = require('razorpay');

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly razorpay: any;
  private readonly keyId: string;
  private readonly keySecret: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
  ) {
    this.keyId = this.configService.get<string>('razorpay.keyId');
    this.keySecret = this.configService.get<string>('razorpay.keySecret');
    this.razorpay = new Razorpay({
      key_id: this.keyId,
      key_secret: this.keySecret,
    });
  }

  async initiatePayment(userId: string, dto: InitiatePaymentDto) {
    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
      select: { id: true, userId: true, status: true, totalAmount: true, razorpayOrderId: true },
    });

    if (!order) throw new NotFoundException('Order not found');
    if (order.userId !== userId) throw new ForbiddenException('You do not own this order');
    if (order.status !== 'PENDING_PAYMENT')
      throw new BadRequestException(`Order is already ${order.status.toLowerCase().replace('_', ' ')}`);

    const amountInPaise = Math.round(Number(order.totalAmount) * 100);
    if (amountInPaise < 100)
      throw new BadRequestException('Order amount is below the minimum chargeable amount');

    if (order.razorpayOrderId) {
      return { razorpayOrderId: order.razorpayOrderId, amount: amountInPaise, currency: 'INR', keyId: this.keyId };
    }

    let razorpayOrder: any;
    try {
      razorpayOrder = await this.razorpay.orders.create({
        amount: amountInPaise,
        currency: 'INR',
        receipt: dto.orderId,
      });
    } catch (err: any) {
      const rzpError = err?.error ?? err;
      this.logger.error(
        `Razorpay order creation failed [${rzpError?.code ?? 'UNKNOWN'}]: ${rzpError?.description ?? err?.message}`,
      );
      if (err?.statusCode === 400) {
        throw new BadRequestException(rzpError?.description ?? 'Payment initiation failed');
      }
      throw new InternalServerErrorException('Payment gateway error. Please try again later.');
    }

    await this.prisma.order.update({
      where: { id: dto.orderId },
      data: { razorpayOrderId: razorpayOrder.id },
    });

    this.logger.log(`Razorpay order created: ${razorpayOrder.id} for internal order: ${dto.orderId}`);

    return { razorpayOrderId: razorpayOrder.id, amount: amountInPaise, currency: 'INR', keyId: this.keyId };
  }

  async verifyPayment(userId: string, dto: VerifyPaymentDto) {
    const expectedSignature = createHmac('sha256', this.keySecret)
      .update(`${dto.razorpayOrderId}|${dto.razorpayPaymentId}`)
      .digest('hex');

    if (expectedSignature !== dto.razorpaySignature) {
      this.logger.warn(`Signature mismatch for internal order ${dto.internalOrderId}`);
      throw new UnauthorizedException('Invalid payment signature');
    }

    const order = await this.prisma.order.findUnique({
      where: { id: dto.internalOrderId },
      select: { id: true, userId: true, razorpayOrderId: true },
    });

    if (!order) throw new NotFoundException('Order not found');
    if (order.userId !== userId) throw new ForbiddenException('You do not own this order');
    if (order.razorpayOrderId !== dto.razorpayOrderId)
      throw new BadRequestException('Razorpay order ID does not match this order');

    return this.ordersService.confirmOrder(dto.internalOrderId, userId, dto.razorpayPaymentId);
  }
}
