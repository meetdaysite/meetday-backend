import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac } from 'crypto';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { ConfigService } from '@nestjs/config';

// Mock Razorpay before it is imported
const mockRazorpayCreate = jest.fn();
jest.mock('razorpay', () =>
  jest.fn().mockImplementation(() => ({
    orders: { create: mockRazorpayCreate },
  })),
);

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePrisma() {
  return {
    order: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  } as any;
}

const KEY_ID = 'rzp_test_key';
const KEY_SECRET = 'rzp_test_secret';

const mockConfig = {
  get: jest.fn((key: string) => {
    if (key === 'razorpay.keyId') return KEY_ID;
    if (key === 'razorpay.keySecret') return KEY_SECRET;
    return undefined;
  }),
};
const mockOrders = { confirmOrder: jest.fn() };

// ── Fixtures ─────────────────────────────────────────────────────────────────

const userId = 'user-uuid';
const orderId = 'order-uuid';
const rzpOrderId = 'order_razorpay123';
const rzpPaymentId = 'pay_razorpay456';

function makeRzpSignature(rzpOId: string, rzpPId: string) {
  return createHmac('sha256', KEY_SECRET).update(`${rzpOId}|${rzpPId}`).digest('hex');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: mockConfig },
        { provide: OrdersService, useValue: mockOrders },
      ],
    }).compile();

    service = module.get(PaymentsService);
  });

  // ── initiatePayment ──────────────────────────────────────────────────────

  describe('initiatePayment', () => {
    const dto = { orderId };

    it('throws NotFoundException when order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null);
      await expect(service.initiatePayment(userId, dto)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when user does not own the order', async () => {
      prisma.order.findUnique.mockResolvedValue({ id: orderId, userId: 'other-user', status: 'PENDING_PAYMENT', totalAmount: '500', razorpayOrderId: null });
      await expect(service.initiatePayment(userId, dto)).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when order is not PENDING_PAYMENT', async () => {
      prisma.order.findUnique.mockResolvedValue({ id: orderId, userId, status: 'CONFIRMED', totalAmount: '500', razorpayOrderId: null });
      await expect(service.initiatePayment(userId, dto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when amount is below minimum paise', async () => {
      prisma.order.findUnique.mockResolvedValue({ id: orderId, userId, status: 'PENDING_PAYMENT', totalAmount: '0.50', razorpayOrderId: null });
      await expect(service.initiatePayment(userId, dto)).rejects.toThrow(BadRequestException);
    });

    it('returns existing razorpayOrderId without calling Razorpay again', async () => {
      prisma.order.findUnique.mockResolvedValue({ id: orderId, userId, status: 'PENDING_PAYMENT', totalAmount: '500', razorpayOrderId: rzpOrderId });
      const result = await service.initiatePayment(userId, dto);
      expect(mockRazorpayCreate).not.toHaveBeenCalled();
      expect(result.razorpayOrderId).toBe(rzpOrderId);
      expect(result.amount).toBe(50000);
    });

    it('creates Razorpay order and persists ID on success', async () => {
      prisma.order.findUnique.mockResolvedValue({ id: orderId, userId, status: 'PENDING_PAYMENT', totalAmount: '500', razorpayOrderId: null });
      mockRazorpayCreate.mockResolvedValue({ id: 'order_new123' });
      prisma.order.update.mockResolvedValue({});

      const result = await service.initiatePayment(userId, dto);

      expect(mockRazorpayCreate).toHaveBeenCalledWith({ amount: 50000, currency: 'INR', receipt: orderId });
      expect(prisma.order.update).toHaveBeenCalledWith({ where: { id: orderId }, data: { razorpayOrderId: 'order_new123' } });
      expect(result.razorpayOrderId).toBe('order_new123');
      expect(result.keyId).toBe(KEY_ID);
    });

    it('throws BadRequestException when Razorpay returns 400', async () => {
      prisma.order.findUnique.mockResolvedValue({ id: orderId, userId, status: 'PENDING_PAYMENT', totalAmount: '500', razorpayOrderId: null });
      const err: any = new Error('bad request');
      err.statusCode = 400;
      err.error = { description: 'Invalid amount' };
      mockRazorpayCreate.mockRejectedValue(err);

      await expect(service.initiatePayment(userId, dto)).rejects.toThrow(BadRequestException);
    });

    it('throws InternalServerErrorException on Razorpay 5xx', async () => {
      prisma.order.findUnique.mockResolvedValue({ id: orderId, userId, status: 'PENDING_PAYMENT', totalAmount: '500', razorpayOrderId: null });
      mockRazorpayCreate.mockRejectedValue(new Error('gateway timeout'));

      await expect(service.initiatePayment(userId, dto)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ── verifyPayment ────────────────────────────────────────────────────────

  describe('verifyPayment', () => {
    const dto = {
      razorpayOrderId: rzpOrderId,
      razorpayPaymentId: rzpPaymentId,
      razorpaySignature: makeRzpSignature(rzpOrderId, rzpPaymentId),
      internalOrderId: orderId,
    };

    it('throws UnauthorizedException on signature mismatch', async () => {
      const badDto = { ...dto, razorpaySignature: 'bad_sig' };
      await expect(service.verifyPayment(userId, badDto)).rejects.toThrow(UnauthorizedException);
    });

    it('throws NotFoundException when order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null);
      await expect(service.verifyPayment(userId, dto)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when user does not own the order', async () => {
      prisma.order.findUnique.mockResolvedValue({ id: orderId, userId: 'other-user', razorpayOrderId: rzpOrderId });
      await expect(service.verifyPayment(userId, dto)).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when razorpayOrderId does not match', async () => {
      prisma.order.findUnique.mockResolvedValue({ id: orderId, userId, razorpayOrderId: 'order_different' });
      await expect(service.verifyPayment(userId, dto)).rejects.toThrow(BadRequestException);
    });

    it('delegates to ordersService.confirmOrder on valid payment', async () => {
      prisma.order.findUnique.mockResolvedValue({ id: orderId, userId, razorpayOrderId: rzpOrderId });
      mockOrders.confirmOrder.mockResolvedValue({ id: orderId, status: 'CONFIRMED' });

      const result = await service.verifyPayment(userId, dto);

      expect(mockOrders.confirmOrder).toHaveBeenCalledWith(orderId, userId, rzpPaymentId);
      expect(result).toMatchObject({ status: 'CONFIRMED' });
    });
  });
});
