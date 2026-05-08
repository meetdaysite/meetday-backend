import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getQueueToken } from '@nestjs/bull';
import { BillingCycle, HostPlan } from '@prisma/client';
import { HostsService } from './hosts.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { KYC_PROVIDER } from './interfaces/kyc-provider.interface';
import { SubscriptionService } from './subscription.service';
import { PennyDropService } from './penny-drop.service';
import { BankAccountType } from './dto/submit-kyc.dto';
import { NotificationsService } from '../notifications/notifications.service';

// ── Mock factories ───────────────────────────────────────────────────────────

function makePrisma() {
  const prisma: any = {
    user: { findUnique: jest.fn() },
    role: { findUniqueOrThrow: jest.fn() },
    category: { findMany: jest.fn() },
    hostProfile: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    hostExperienceCategory: { deleteMany: jest.fn().mockResolvedValue({}), createMany: jest.fn().mockResolvedValue({}) },
    hostPayoutAccount: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    hostPayoutAccountHistory: { create: jest.fn().mockResolvedValue({}) },
    hostSubscription: { updateMany: jest.fn().mockResolvedValue({ count: 0 }), create: jest.fn() },
    subscriptionPlan: { findUnique: jest.fn() },
    coupon: { findUnique: jest.fn() },
    couponRedemption: { create: jest.fn(), count: jest.fn().mockResolvedValue(0) },
  };
  prisma.$transaction = jest.fn().mockImplementation(async (fn: any) => {
    if (Array.isArray(fn)) return Promise.all(fn);
    return fn(prisma);
  });
  return prisma;
}

const mockCrypto = {
  encrypt: jest.fn().mockReturnValue('enc::pan'),
  decrypt: jest.fn().mockReturnValue('ABCDE1234F'),
};
const mockKycProvider = { initiateVerification: jest.fn() };
const mockSubscriptionService = { createPlanAndSubscription: jest.fn(), cancelSubscription: jest.fn() };
const mockPennyDropService = { initiatePennyDrop: jest.fn() };
const mockMailQueue = { add: jest.fn() };

// ── Fixtures ─────────────────────────────────────────────────────────────────

const userId = 'user-uuid';
const hostProfileId = 'hp-uuid';
const payoutAccountId = 'pa-uuid';
const categoryId = '11111111-1111-1111-1111-111111111111';

const baseProfile = {
  id: hostProfileId,
  userId,
  legalName: 'Priya Nair',
  panEncrypted: 'enc::pan',
  kycStatus: 'NOT_SUBMITTED',
  panVerificationStatus: 'NOT_SUBMITTED',
  bankVerificationStatus: 'NOT_SUBMITTED',
  approvalStatus: 'PENDING',
  currentPlan: 'DISCOVER',
  payoutAccount: null,
  user: { email: 'test@test.com', firstName: 'Priya', phone: '+919876543210' },
  subscriptions: [],
  categories: [],
  address: null,
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('HostsService', () => {
  let service: HostsService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        HostsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CryptoService, useValue: mockCrypto },
        { provide: KYC_PROVIDER, useValue: mockKycProvider },
        { provide: SubscriptionService, useValue: mockSubscriptionService },
        { provide: PennyDropService, useValue: mockPennyDropService },
        { provide: getQueueToken('mail'), useValue: mockMailQueue },
        { provide: NotificationsService, useValue: { create: jest.fn() } },
      ],
    }).compile();

    service = module.get(HostsService);
  });

  // ── applyAsHost() ────────────────────────────────────────────────────────

  describe('applyAsHost()', () => {
    const dto = {
      hostType: 'INDIVIDUAL' as const,
      categoryIds: [categoryId],
    };

    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue({ id: userId, hostProfile: null, role: { name: 'USER' } });
      prisma.category.findMany.mockResolvedValue([{ id: categoryId }]);
      prisma.role.findUniqueOrThrow.mockResolvedValue({ id: 'role-host-id', name: 'HOST' });
      prisma.hostProfile.create.mockResolvedValue({ ...baseProfile, categories: [], address: null });
      prisma.user.findUnique.mockResolvedValue({ id: userId, hostProfile: null, role: { name: 'USER' } });
    });

    it('creates HostProfile and promotes USER to HOST atomically', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: userId, hostProfile: null, role: { name: 'USER' } });
      prisma.user.update = jest.fn().mockResolvedValue({});
      const result = await service.applyAsHost(userId, dto);
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.hostProfile.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            kycStatus: 'NOT_SUBMITTED',
            approvalStatus: 'PENDING',
            currentPlan: 'DISCOVER',
          }),
        }),
      );
      expect(result).toMatchObject({ kycStatus: 'NOT_SUBMITTED' });
    });

    it('throws ConflictException when host profile already exists', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: userId, hostProfile: { id: 'existing' }, role: { name: 'HOST' } });
      await expect(service.applyAsHost(userId, dto)).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.applyAsHost(userId, dto)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for invalid categoryIds', async () => {
      prisma.category.findMany.mockResolvedValue([]); // none found
      await expect(service.applyAsHost(userId, dto)).rejects.toThrow(BadRequestException);
    });
  });

  // ── getOwnHostProfile() ──────────────────────────────────────────────────

  describe('getOwnHostProfile()', () => {
    it('returns profile with decrypted PAN', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue({ ...baseProfile, subscriptions: [] });
      const result = await service.getOwnHostProfile(userId);
      expect(mockCrypto.decrypt).toHaveBeenCalledWith('enc::pan');
      expect(result).toMatchObject({ pan: 'ABCDE1234F' });
      expect((result as any).panEncrypted).toBeUndefined();
    });

    it('returns pan=null when panEncrypted is absent', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue({ ...baseProfile, panEncrypted: null, subscriptions: [] });
      const result = await service.getOwnHostProfile(userId);
      expect((result as any).pan).toBeNull();
    });

    it('throws NotFoundException when host profile does not exist', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue(null);
      await expect(service.getOwnHostProfile(userId)).rejects.toThrow(NotFoundException);
    });
  });

  // ── updateHostProfile() ──────────────────────────────────────────────────

  describe('updateHostProfile()', () => {
    beforeEach(() => {
      prisma.hostProfile.findUnique.mockResolvedValue({ id: hostProfileId });
      prisma.hostProfile.update.mockResolvedValue({ ...baseProfile, displayName: 'New Name' });
    });

    it('updates only the provided fields', async () => {
      await service.updateHostProfile(userId, { displayName: 'New Name' });
      expect(prisma.hostProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ displayName: 'New Name' }),
        }),
      );
    });

    it('replaces all categories when categoryIds is provided', async () => {
      prisma.category.findMany.mockResolvedValue([{ id: categoryId }]);
      await service.updateHostProfile(userId, { categoryIds: [categoryId] });
      expect(prisma.hostExperienceCategory.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { hostProfileId } }),
      );
      expect(prisma.hostExperienceCategory.createMany).toHaveBeenCalled();
    });

    it('throws BadRequestException for invalid category IDs', async () => {
      prisma.category.findMany.mockResolvedValue([]);
      await expect(
        service.updateHostProfile(userId, { categoryIds: ['bad-id'] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when profile does not exist', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue(null);
      await expect(service.updateHostProfile(userId, {})).rejects.toThrow(NotFoundException);
    });
  });

  // ── submitKyc() ──────────────────────────────────────────────────────────

  describe('submitKyc()', () => {
    const kycDto = {
      bankAccount: {
        accountNumber: '123456789012',
        ifscCode: 'HDFC0001234',
        accountHolderName: 'Priya Nair',
        accountType: BankAccountType.SAVINGS,
      },
    };
    const newPayoutId = 'new-pa-uuid';

    beforeEach(() => {
      prisma.hostProfile.findUnique.mockResolvedValue({ ...baseProfile, payoutAccount: null });
      prisma.hostPayoutAccount.create.mockResolvedValue({ id: newPayoutId, status: 'PENDING_PENNY_DROP' });
      prisma.hostProfile.update.mockResolvedValue({});
      prisma.hostPayoutAccount.update.mockResolvedValue({});
      mockKycProvider.initiateVerification.mockResolvedValue({
        referenceId: 'pan-ref-123',
        // undefined verificationStatus = async provider, result via webhook
      });
      mockPennyDropService.initiatePennyDrop.mockResolvedValue({
        pennyDropReference: 'pd-ref-123',
      });
    });

    it('sets KYC status fields to PENDING in transaction', async () => {
      await service.submitKyc(userId, kycDto);
      expect(prisma.hostProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            panVerificationStatus: 'PENDING',
            bankVerificationStatus: 'PENDING',
            kycStatus: 'PENDING',
          }),
        }),
      );
    });

    it('masks account number to last 4 digits', async () => {
      await service.submitKyc(userId, kycDto);
      expect(prisma.hostPayoutAccount.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ maskedAccountNumber: 'XXXX9012' }),
        }),
      );
    });

    it('initiates PAN verification and penny drop', async () => {
      await service.submitKyc(userId, kycDto);
      expect(mockKycProvider.initiateVerification).toHaveBeenCalled();
      expect(mockPennyDropService.initiatePennyDrop).toHaveBeenCalled();
    });

    it('hard-deletes PENDING_PENNY_DROP payout account before creating new one', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue({
        ...baseProfile,
        payoutAccount: { id: 'old-pa', status: 'PENDING_PENNY_DROP', deactivatedAt: null },
      });
      prisma.hostPayoutAccount.delete.mockResolvedValue({});

      await service.submitKyc(userId, kycDto);
      expect(prisma.hostPayoutAccount.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'old-pa' } }),
      );
    });

    it('soft-deletes PENDING_ADMIN_REVIEW payout account', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue({
        ...baseProfile,
        payoutAccount: { id: 'old-pa', status: 'PENDING_ADMIN_REVIEW', deactivatedAt: null },
      });

      await service.submitKyc(userId, kycDto);
      expect(prisma.hostPayoutAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'old-pa' },
          data: expect.objectContaining({ status: 'DEACTIVATED', deactivationReason: 'RESUBMITTED_KYC' }),
        }),
      );
    });

    it('throws BadRequestException when PAN is missing', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue({ ...baseProfile, panEncrypted: null });
      await expect(service.submitKyc(userId, kycDto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when legalName is missing', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue({ ...baseProfile, legalName: null });
      await expect(service.submitKyc(userId, kycDto)).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when KYC is already verified and not rejected', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue({
        ...baseProfile,
        kycStatus: 'VERIFIED',
        approvalStatus: 'APPROVED',
        payoutAccount: null,
      });
      await expect(service.submitKyc(userId, kycDto)).rejects.toThrow(ConflictException);
    });

    describe('sync provider (Sandbox) — immediate result', () => {
      it('sets kycStatus=VERIFIED when both legs succeed synchronously', async () => {
        mockKycProvider.initiateVerification.mockResolvedValue({
          referenceId: 'pan-ref',
          verificationStatus: 'VERIFIED',
        });
        mockPennyDropService.initiatePennyDrop.mockResolvedValue({
          pennyDropReference: 'pd-ref',
          verificationStatus: 'VERIFIED',
          bankName: 'HDFC Bank',
        });
        // Update calls chain: first for PAN, then bank history, then final kycStatus
        prisma.hostProfile.update.mockResolvedValue({});
        prisma.hostPayoutAccount.update.mockResolvedValue({});
        prisma.hostPayoutAccountHistory.create.mockResolvedValue({});

        await service.submitKyc(userId, kycDto);

        // kycStatus=VERIFIED is set in applyBankVerificationResult or applyPanVerificationResult
        const profileUpdateCalls = (prisma.hostProfile.update as jest.Mock).mock.calls;
        const verifiedCall = profileUpdateCalls.find((call: any) =>
          call[0]?.data?.kycStatus === 'VERIFIED',
        );
        expect(verifiedCall).toBeDefined();
      });

      it('sets kycStatus=FAILED and sends email when PAN fails', async () => {
        mockKycProvider.initiateVerification.mockResolvedValue({
          referenceId: 'pan-ref',
          verificationStatus: 'FAILED',
          failureReason: 'Name mismatch',
        });
        prisma.hostProfile.update.mockResolvedValue({});
        prisma.hostPayoutAccount.update.mockResolvedValue({});

        await service.submitKyc(userId, kycDto);

        const profileUpdateCalls = (prisma.hostProfile.update as jest.Mock).mock.calls;
        const failedCall = profileUpdateCalls.find((call: any) =>
          call[0]?.data?.kycStatus === 'FAILED',
        );
        expect(failedCall).toBeDefined();
        expect(mockMailQueue.add).toHaveBeenCalledWith('kyc-failed', expect.any(Object));
      });
    });
  });

  // ── handleBankWebhook() ──────────────────────────────────────────────────

  describe('handleBankWebhook()', () => {
    const webhookDto = {
      pennyDropReference: 'pd-ref',
      hostPayoutAccountId: payoutAccountId,
      status: 'SUCCESS' as const,
      bankName: 'ICICI Bank',
    };

    it('ignores stale webhooks for deactivated payout accounts', async () => {
      prisma.hostPayoutAccount.findUnique.mockResolvedValue({
        id: payoutAccountId,
        deactivatedAt: new Date(),
        hostProfile: { ...baseProfile, panVerificationStatus: 'VERIFIED', user: baseProfile.user },
      });

      await service.handleBankWebhook(webhookDto);

      expect(prisma.hostPayoutAccount.update).not.toHaveBeenCalled();
    });

    it('sets payout status=PENDING_ADMIN_REVIEW on SUCCESS', async () => {
      prisma.hostPayoutAccount.findUnique.mockResolvedValue({
        id: payoutAccountId,
        deactivatedAt: null,
        hostProfile: { ...baseProfile, panVerificationStatus: 'PENDING', user: baseProfile.user },
      });
      prisma.hostPayoutAccount.update.mockResolvedValue({});
      prisma.hostPayoutAccountHistory.create.mockResolvedValue({});
      prisma.hostProfile.update.mockResolvedValue({});

      await service.handleBankWebhook(webhookDto);

      expect(prisma.hostPayoutAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PENDING_ADMIN_REVIEW' }),
        }),
      );
    });

    it('sets kycStatus=VERIFIED when PAN was already VERIFIED', async () => {
      prisma.hostPayoutAccount.findUnique.mockResolvedValue({
        id: payoutAccountId,
        deactivatedAt: null,
        hostProfile: { ...baseProfile, id: hostProfileId, panVerificationStatus: 'VERIFIED', user: baseProfile.user },
      });
      prisma.hostPayoutAccount.update.mockResolvedValue({});
      prisma.hostPayoutAccountHistory.create.mockResolvedValue({});
      prisma.hostProfile.update.mockResolvedValue({});

      await service.handleBankWebhook(webhookDto);

      expect(prisma.hostProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ kycStatus: 'VERIFIED' }),
        }),
      );
    });

    it('sets kycStatus=FAILED and sends email on bank FAILED', async () => {
      prisma.hostPayoutAccount.findUnique.mockResolvedValue({
        id: payoutAccountId,
        deactivatedAt: null,
        hostProfile: { ...baseProfile, id: hostProfileId, panVerificationStatus: 'PENDING', user: baseProfile.user },
      });
      prisma.hostPayoutAccount.update.mockResolvedValue({});
      prisma.hostPayoutAccountHistory.create.mockResolvedValue({});
      prisma.hostProfile.update.mockResolvedValue({});

      await service.handleBankWebhook({ ...webhookDto, status: 'FAILED' });

      expect(prisma.hostProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ kycStatus: 'FAILED' }) }),
      );
      expect(mockMailQueue.add).toHaveBeenCalledWith('kyc-failed', expect.any(Object));
    });

    it('throws NotFoundException when payout account not found', async () => {
      prisma.hostPayoutAccount.findUnique.mockResolvedValue(null);
      await expect(service.handleBankWebhook(webhookDto)).rejects.toThrow(NotFoundException);
    });
  });

  // ── reapply() ────────────────────────────────────────────────────────────

  describe('reapply()', () => {
    it('resets all KYC and approval fields', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue({ ...baseProfile, kycStatus: 'FAILED', payoutAccount: null });
      prisma.hostProfile.update.mockResolvedValue({});
      // findUnique called at end of transaction
      (prisma.hostProfile.findUnique as jest.Mock).mockResolvedValueOnce({ ...baseProfile, kycStatus: 'FAILED', payoutAccount: null });

      await service.reapply(userId);

      expect(prisma.hostProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            kycStatus: 'NOT_SUBMITTED',
            panVerificationStatus: 'NOT_SUBMITTED',
            bankVerificationStatus: 'NOT_SUBMITTED',
            approvalStatus: 'PENDING',
          }),
        }),
      );
    });

    it('hard-deletes PENDING_PENNY_DROP payout account', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue({
        ...baseProfile,
        kycStatus: 'FAILED',
        payoutAccount: { id: 'pa-id', status: 'PENDING_PENNY_DROP', deactivatedAt: null },
      });
      prisma.hostProfile.update.mockResolvedValue({});
      prisma.hostPayoutAccount.delete.mockResolvedValue({});

      await service.reapply(userId);
      expect(prisma.hostPayoutAccount.delete).toHaveBeenCalledWith({ where: { id: 'pa-id' } });
    });

    it('soft-deletes active payout account', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue({
        ...baseProfile,
        kycStatus: 'FAILED',
        payoutAccount: { id: 'pa-id', status: 'PENDING_ADMIN_REVIEW', deactivatedAt: null },
      });
      prisma.hostProfile.update.mockResolvedValue({});
      prisma.hostPayoutAccount.update.mockResolvedValue({});
      prisma.hostPayoutAccountHistory.create.mockResolvedValue({});

      await service.reapply(userId);
      expect(prisma.hostPayoutAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'DEACTIVATED', deactivationReason: 'REAPPLICATION' }),
        }),
      );
    });

    it('throws BadRequestException when KYC is not failed and approval not rejected', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue({
        ...baseProfile,
        kycStatus: 'VERIFIED',
        approvalStatus: 'APPROVED',
        payoutAccount: null,
      });
      await expect(service.reapply(userId)).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when profile not found', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue(null);
      await expect(service.reapply(userId)).rejects.toThrow(NotFoundException);
    });
  });

  // ── upgradeSubscription() ────────────────────────────────────────────────

  describe('upgradeSubscription()', () => {
    const upgradeDto = { plan: HostPlan.COMMUNITY, billingCycle: BillingCycle.MONTHLY };
    const planRecord = { id: 'sp-id', plan: 'COMMUNITY', yearlyPrice: 14999, monthlyPrice: 1499, platformFeeRate: 7, isActive: true };
    const razorpayResult = {
      razorpayPlanId: 'rzp-plan-id',
      razorpaySubscriptionId: 'rzp-sub-id',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    };
    const newSubscription = { id: 'sub-id', plan: 'COMMUNITY', status: 'ACTIVE', lockedFeeRate: 7 };

    beforeEach(() => {
      prisma.hostProfile.findUnique.mockResolvedValue({
        ...baseProfile,
        approvalStatus: 'APPROVED',
        userId,
        user: { email: 'test@test.com', firstName: 'Priya' },
      });
      prisma.subscriptionPlan.findUnique.mockResolvedValue(planRecord);
      mockSubscriptionService.createPlanAndSubscription.mockResolvedValue(razorpayResult);
      prisma.hostSubscription.updateMany.mockResolvedValue({ count: 0 });
      prisma.hostSubscription.create.mockResolvedValue(newSubscription);
      prisma.hostProfile.update.mockResolvedValue({});
    });

    it('creates Razorpay subscription and DB record', async () => {
      const result = await service.upgradeSubscription(userId, upgradeDto);
      expect(mockSubscriptionService.createPlanAndSubscription).toHaveBeenCalled();
      expect(prisma.hostSubscription.create).toHaveBeenCalled();
      expect(result).toMatchObject({ status: 'ACTIVE' });
    });

    it('locks fee rate from plan record', async () => {
      await service.upgradeSubscription(userId, upgradeDto);
      expect(prisma.hostSubscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ lockedFeeRate: planRecord.platformFeeRate }),
        }),
      );
    });

    it('cancels existing active subscription before creating new one', async () => {
      await service.upgradeSubscription(userId, upgradeDto);
      expect(prisma.hostSubscription.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'ACTIVE' }),
          data: expect.objectContaining({ status: 'CANCELLED', cancelReason: 'UPGRADE' }),
        }),
      );
    });

    it('throws ForbiddenException when host is not APPROVED', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue({ ...baseProfile, approvalStatus: 'PENDING', userId });
      await expect(service.upgradeSubscription(userId, upgradeDto)).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException for SELL plan with MONTHLY billing', async () => {
      prisma.hostProfile.findUnique.mockResolvedValue({
        ...baseProfile,
        approvalStatus: 'APPROVED',
        userId,
        user: { email: 'test@test.com', firstName: 'Priya' },
      });
      await expect(
        service.upgradeSubscription(userId, { plan: HostPlan.SELL, billingCycle: BillingCycle.MONTHLY }),
      ).rejects.toThrow(BadRequestException);
    });

    describe('coupon redemption', () => {
      const coupon = {
        id: 'coupon-id',
        code: 'SAVE10',
        target: 'HOST',
        discountType: 'PERCENTAGE',
        discountValue: 10,
        isActive: true,
        validFrom: null,
        validUntil: null,
        maxUsages: null,
        usageCount: 0,
        maxUsagesPerUser: null,
      };

      beforeEach(() => {
        prisma.coupon.findUnique.mockResolvedValue(coupon);
        prisma.couponRedemption.create.mockResolvedValue({});
        prisma.coupon.update = jest.fn().mockResolvedValue({});
      });

      it('applies PERCENTAGE discount to fee rate', async () => {
        await service.upgradeSubscription(userId, { ...upgradeDto, couponCode: 'SAVE10' });
        const createCall = (prisma.hostSubscription.create as jest.Mock).mock.calls[0][0];
        // 10% off rate=7 → 6.3
        expect(createCall.data.lockedFeeRate).toBeCloseTo(6.3, 5);
      });

      it('throws BadRequestException for wrong target (ATTENDEE coupon on host sub)', async () => {
        prisma.coupon.findUnique.mockResolvedValue({ ...coupon, target: 'ATTENDEE' });
        await expect(
          service.upgradeSubscription(userId, { ...upgradeDto, couponCode: 'SAVE10' }),
        ).rejects.toThrow(BadRequestException);
      });

      it('throws BadRequestException for expired coupon', async () => {
        prisma.coupon.findUnique.mockResolvedValue({
          ...coupon,
          validUntil: new Date(Date.now() - 1000),
        });
        await expect(
          service.upgradeSubscription(userId, { ...upgradeDto, couponCode: 'SAVE10' }),
        ).rejects.toThrow(BadRequestException);
      });

      it('throws BadRequestException for inactive coupon', async () => {
        prisma.coupon.findUnique.mockResolvedValue({ ...coupon, isActive: false });
        await expect(
          service.upgradeSubscription(userId, { ...upgradeDto, couponCode: 'SAVE10' }),
        ).rejects.toThrow(BadRequestException);
      });
    });
  });
});
