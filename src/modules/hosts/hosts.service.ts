import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { BillingCycle, CouponTarget, DiscountType, HostPlan, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { KYC_PROVIDER, KycProvider } from './interfaces/kyc-provider.interface';
import { SubscriptionService } from './subscription.service';
import { PennyDropService } from './penny-drop.service';
import { ApplyHostDto } from './dto/apply-host.dto';
import { UpdateHostProfileDto } from './dto/update-host-profile.dto';
import { SubmitKycDto } from './dto/submit-kyc.dto';
import { PanWebhookDto } from './dto/pan-webhook.dto';
import { BankWebhookDto } from './dto/bank-webhook.dto';
import { UpgradeSubscriptionDto } from './dto/upgrade-subscription.dto';

@Injectable()
export class HostsService {
  private readonly logger = new Logger(HostsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cryptoService: CryptoService,
    @Inject(KYC_PROVIDER) private readonly kycProvider: KycProvider,
    private readonly subscriptionService: SubscriptionService,
    private readonly pennyDropService: PennyDropService,
    @InjectQueue('mail') private readonly mailQueue: Queue,
  ) {}

  async applyAsHost(userId: string, dto: ApplyHostDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { hostProfile: true, role: true },
    });

    if (!user) throw new NotFoundException('User not found');
    if (user.hostProfile) throw new ConflictException('Host profile already exists');

    const validCategories = await this.prisma.category.findMany({
      where: { id: { in: dto.categoryIds } },
      select: { id: true },
    });
    if (validCategories.length !== dto.categoryIds.length) {
      throw new BadRequestException('One or more category IDs are invalid');
    }

    const hostRole = await this.prisma.role.findUniqueOrThrow({ where: { name: 'HOST' } });

    return this.prisma.$transaction(async (tx) => {
      const hostProfile = await tx.hostProfile.create({
        data: {
          userId,
          hostType: dto.hostType,
          displayName: dto.displayName,
          legalName: dto.legalName,
          panEncrypted: dto.pan ? this.cryptoService.encrypt(dto.pan) : undefined,
          hostBio: dto.hostBio,
          tagline: dto.tagline,
          languages: dto.languages ?? [],
          yearsOfExperience: dto.yearsOfExperience,
          totalEventsPreviouslyHosted: dto.totalEventsPreviouslyHosted,
          operatingCities: dto.operatingCities ?? [],
          portfolioLinks: dto.portfolioLinks ?? [],
          socialLinks: dto.socialLinks ? JSON.parse(JSON.stringify(dto.socialLinks)) : undefined,
          kycStatus: 'NOT_SUBMITTED',
          approvalStatus: 'PENDING',
          currentPlan: 'DISCOVER',
          categories: {
            create: dto.categoryIds.map((categoryId) => ({ categoryId })),
          },
          ...(dto.address && {
            address: { create: dto.address },
          }),
        },
        include: {
          categories: { include: { category: true } },
          address: true,
        },
      });

      // Promote USER → HOST role if not already a host
      if (user.role.name === 'USER') {
        await tx.user.update({
          where: { id: userId },
          data: { roleId: hostRole.id },
        });
      }

      return hostProfile;
    });
  }

  async getOwnHostProfile(userId: string) {
    const profile = await this.prisma.hostProfile.findUnique({
      where: { userId },
      include: {
        categories: { include: { category: true } },
        address: true,
        subscriptions: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!profile) throw new NotFoundException('Host profile not found');
    return profile;
  }

  async updateHostProfile(userId: string, dto: UpdateHostProfileDto) {
    const profile = await this.prisma.hostProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Host profile not found');

    if (dto.categoryIds !== undefined) {
      const validCategories = await this.prisma.category.findMany({
        where: { id: { in: dto.categoryIds } },
        select: { id: true },
      });
      if (validCategories.length !== dto.categoryIds.length) {
        throw new BadRequestException('One or more category IDs are invalid');
      }

      await this.prisma.$transaction([
        this.prisma.hostExperienceCategory.deleteMany({ where: { hostProfileId: profile.id } }),
        this.prisma.hostExperienceCategory.createMany({
          data: dto.categoryIds.map((categoryId) => ({ hostProfileId: profile.id, categoryId })),
        }),
      ]);
    }

    const { categoryIds: _, address, pan, ...fields } = dto;

    return this.prisma.hostProfile.update({
      where: { id: profile.id },
      data: {
        ...(fields.hostType !== undefined && { hostType: fields.hostType }),
        ...(fields.displayName !== undefined && { displayName: fields.displayName }),
        ...(fields.legalName !== undefined && { legalName: fields.legalName }),
        ...(pan !== undefined && { panEncrypted: this.cryptoService.encrypt(pan) }),
        ...(fields.hostBio !== undefined && { hostBio: fields.hostBio }),
        ...(fields.tagline !== undefined && { tagline: fields.tagline }),
        ...(fields.languages !== undefined && { languages: fields.languages }),
        ...(fields.yearsOfExperience !== undefined && { yearsOfExperience: fields.yearsOfExperience }),
        ...(fields.totalEventsPreviouslyHosted !== undefined && { totalEventsPreviouslyHosted: fields.totalEventsPreviouslyHosted }),
        ...(fields.operatingCities !== undefined && { operatingCities: fields.operatingCities }),
        ...(fields.portfolioLinks !== undefined && { portfolioLinks: fields.portfolioLinks }),
        ...(fields.socialLinks !== undefined && {
          socialLinks: JSON.parse(JSON.stringify(fields.socialLinks)),
        }),
        ...(address !== undefined && {
          address: {
            upsert: {
              create: address,
              update: address,
            },
          },
        }),
      },
      include: {
        categories: { include: { category: true } },
        address: true,
      },
    });
  }

  async submitKyc(userId: string, dto: SubmitKycDto) {
    const profile = await this.prisma.hostProfile.findUnique({
      where: { userId },
      include: { payoutAccount: true },
    });
    if (!profile) throw new NotFoundException('Host profile not found');

    if (!profile.panEncrypted) {
      throw new BadRequestException(
        'PAN is required before submitting KYC. Please update your profile with your PAN first.',
      );
    }

    if (profile.kycStatus === 'PENDING') {
      throw new ConflictException('KYC verification is already in progress');
    }
    if (profile.kycStatus === 'VERIFIED' && profile.approvalStatus !== 'REJECTED') {
      throw new ConflictException('KYC already verified');
    }

    const maskedAccountNumber = 'XXXX' + dto.bankAccount.accountNumber.slice(-4);
    const existingPayout = profile.payoutAccount;
    let newPayoutAccountId: string;

    await this.prisma.$transaction(async (tx) => {
      // Set KYC fields to PENDING — PAN is already stored from registration
      await tx.hostProfile.update({
        where: { id: profile.id },
        data: {
          panVerificationStatus: 'PENDING',
          panVerificationReference: null,
          bankVerificationStatus: 'PENDING',
          kycStatus: 'PENDING',
          kycFailureReason: null,
        },
      });

      // Clean up any existing non-deactivated payout account
      if (existingPayout && !existingPayout.deactivatedAt) {
        if (existingPayout.status === 'PENDING_PENNY_DROP') {
          // No financial operation yet — hard delete is safe
          await tx.hostPayoutAccount.delete({ where: { id: existingPayout.id } });
        } else {
          await tx.hostPayoutAccount.update({
            where: { id: existingPayout.id },
            data: {
              deactivatedAt: new Date(),
              deactivationReason: 'RESUBMITTED_KYC',
              status: 'DEACTIVATED',
            },
          });
          await tx.hostPayoutAccountHistory.create({
            data: {
              hostPayoutAccountId: existingPayout.id,
              previousStatus: existingPayout.status,
              newStatus: 'DEACTIVATED',
              changeReason: 'RESUBMITTED_KYC',
            },
          });
        }
      }

      // Create new payout account
      const created = await tx.hostPayoutAccount.create({
        data: {
          hostProfileId: profile.id,
          maskedAccountNumber,
          accountHolderName: dto.bankAccount.accountHolderName,
          accountType: dto.bankAccount.accountType,
          status: 'PENDING_PENNY_DROP',
          pennyDropInitiatedAt: new Date(),
          kycStatusAtSubmission: 'PENDING',
        },
      });
      newPayoutAccountId = created.id;
    });

    // Initiate both verifications outside the transaction to avoid holding the DB connection during I/O
    // Decrypt stored PAN to pass to KYC provider — discarded immediately after the call
    const decryptedPan = this.cryptoService.decrypt(profile.panEncrypted!);
    const { referenceId: panReferenceId } = await this.kycProvider.initiateVerification(
      profile.id,
      decryptedPan,
    );
    await this.prisma.hostProfile.update({
      where: { id: profile.id },
      data: { panVerificationReference: panReferenceId },
    });

    const { pennyDropReference } = await this.pennyDropService.initiatePennyDrop(
      newPayoutAccountId!,
      dto.bankAccount.accountNumber,
      dto.bankAccount.ifscCode,
    );
    await this.prisma.hostPayoutAccount.update({
      where: { id: newPayoutAccountId! },
      data: { pennyDropReference },
    });

    return { panReferenceId, pennyDropReference };
  }

  async handlePanWebhook(dto: PanWebhookDto) {
    const profile = await this.prisma.hostProfile.findUnique({
      where: { id: dto.hostProfileId },
      include: {
        user: { select: { email: true, firstName: true } },
        payoutAccount: true,
      },
    });
    if (!profile) throw new NotFoundException('Host profile not found');

    if (dto.status === 'VERIFIED') {
      const updateData: Record<string, unknown> = {
        panVerificationStatus: 'VERIFIED',
        kycFailureReason: null,
      };

      // If penny drop has also succeeded, both legs are done → kycStatus VERIFIED
      if (profile.payoutAccount?.status === 'PENDING_ADMIN_REVIEW') {
        updateData.kycStatus = 'VERIFIED';
        updateData.kycVerifiedAt = new Date();
      }

      await this.prisma.hostProfile.update({ where: { id: profile.id }, data: updateData });
    } else {
      await this.prisma.hostProfile.update({
        where: { id: profile.id },
        data: {
          panVerificationStatus: 'FAILED',
          kycStatus: 'FAILED',
          kycFailureReason: dto.failureReason ?? null,
        },
      });
      void this.mailQueue.add('kyc-failed', {
        to: profile.user.email,
        hostName: profile.user.firstName,
        reason: dto.failureReason ?? null,
      });
    }
  }

  async handleBankWebhook(dto: BankWebhookDto) {
    const payoutAccount = await this.prisma.hostPayoutAccount.findUnique({
      where: { id: dto.hostPayoutAccountId },
      include: {
        hostProfile: {
          include: { user: { select: { email: true, firstName: true } } },
        },
      },
    });
    if (!payoutAccount) throw new NotFoundException('Payout account not found');

    // Stale webhook for a deactivated account — acknowledge and ignore
    if (payoutAccount.deactivatedAt) {
      this.logger.log(
        `Bank webhook received for deactivated payout account ${payoutAccount.id} — ignoring`,
      );
      return;
    }

    const profile = payoutAccount.hostProfile;

    if (dto.status === 'SUCCESS') {
      await this.prisma.hostPayoutAccount.update({
        where: { id: payoutAccount.id },
        data: {
          status: 'PENDING_ADMIN_REVIEW',
          bankName: dto.bankName ?? null,
          pennyDropCompletedAt: new Date(),
          pennyDropFailReason: null,
        },
      });

      await this.prisma.hostPayoutAccountHistory.create({
        data: {
          hostPayoutAccountId: payoutAccount.id,
          previousStatus: payoutAccount.status,
          newStatus: 'PENDING_ADMIN_REVIEW',
          changeReason: 'PENNY_DROP_SUCCESS',
        },
      });

      // If PAN has also been verified, both legs are done → kycStatus VERIFIED
      const profileUpdate: Record<string, unknown> = { bankVerificationStatus: 'VERIFIED' };
      if (profile.panVerificationStatus === 'VERIFIED') {
        profileUpdate.kycStatus = 'VERIFIED';
        profileUpdate.kycVerifiedAt = new Date();
      }
      await this.prisma.hostProfile.update({ where: { id: profile.id }, data: profileUpdate });
    } else {
      await this.prisma.hostPayoutAccount.update({
        where: { id: payoutAccount.id },
        data: {
          status: 'PENNY_DROP_FAILED',
          pennyDropFailReason: dto.failureReason ?? null,
          pennyDropCompletedAt: new Date(),
        },
      });

      await this.prisma.hostPayoutAccountHistory.create({
        data: {
          hostPayoutAccountId: payoutAccount.id,
          previousStatus: payoutAccount.status,
          newStatus: 'PENNY_DROP_FAILED',
          changeReason: 'PENNY_DROP_FAILED',
        },
      });

      await this.prisma.hostProfile.update({
        where: { id: profile.id },
        data: {
          bankVerificationStatus: 'FAILED',
          kycStatus: 'FAILED',
          kycFailureReason: dto.failureReason
            ? `Bank account verification failed: ${dto.failureReason}`
            : 'Bank account verification failed',
        },
      });

      void this.mailQueue.add('kyc-failed', {
        to: profile.user.email,
        hostName: profile.user.firstName,
        reason: dto.failureReason ?? null,
      });
    }
  }

  async reapply(userId: string) {
    const profile = await this.prisma.hostProfile.findUnique({
      where: { userId },
      include: { payoutAccount: true },
    });
    if (!profile) throw new NotFoundException('Host profile not found');

    const canReapply =
      profile.kycStatus === 'FAILED' || profile.approvalStatus === 'REJECTED';

    if (!canReapply) {
      throw new BadRequestException(
        'Reapplication is only allowed after a KYC failure or admin rejection',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.hostProfile.update({
        where: { id: profile.id },
        data: {
          kycStatus: 'NOT_SUBMITTED',
          panVerificationStatus: 'NOT_SUBMITTED',
          panVerificationReference: null,
          bankVerificationStatus: 'NOT_SUBMITTED',
          kycFailureReason: null,
          kycVerifiedAt: null,
          approvalStatus: 'PENDING',
          rejectionReason: null,
          approvedAt: null,
          approvedBy: null,
        },
      });

      const existingPayout = profile.payoutAccount;
      if (existingPayout && !existingPayout.deactivatedAt) {
        if (existingPayout.status === 'PENDING_PENNY_DROP') {
          await tx.hostPayoutAccount.delete({ where: { id: existingPayout.id } });
        } else {
          await tx.hostPayoutAccount.update({
            where: { id: existingPayout.id },
            data: {
              deactivatedAt: new Date(),
              deactivationReason: 'REAPPLICATION',
              status: 'DEACTIVATED',
            },
          });
          await tx.hostPayoutAccountHistory.create({
            data: {
              hostPayoutAccountId: existingPayout.id,
              previousStatus: existingPayout.status,
              newStatus: 'DEACTIVATED',
              changeReason: 'REAPPLICATION',
            },
          });
        }
      }

      return tx.hostProfile.findUnique({ where: { id: profile.id } });
    });
  }

  async getSubscriptionPlans() {
    return this.prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { plan: 'asc' },
    });
  }

  async upgradeSubscription(userId: string, dto: UpgradeSubscriptionDto) {
    const profile = await this.prisma.hostProfile.findUnique({
      where: { userId },
      include: { user: { select: { email: true, firstName: true } } },
    });
    if (!profile) throw new NotFoundException('Host profile not found');
    if (profile.approvalStatus !== 'APPROVED') {
      throw new ForbiddenException('Only approved hosts can upgrade their subscription');
    }

    if (dto.plan === HostPlan.SELL && dto.billingCycle === BillingCycle.MONTHLY) {
      throw new BadRequestException('The SELL plan is only available with yearly billing');
    }

    const planRecord = await this.prisma.subscriptionPlan.findUnique({
      where: { plan: dto.plan },
    });
    if (!planRecord || !planRecord.isActive) {
      throw new NotFoundException('Subscription plan not found or inactive');
    }

    const price =
      dto.billingCycle === BillingCycle.YEARLY
        ? planRecord.yearlyPrice
        : planRecord.monthlyPrice;

    if (!price) {
      throw new BadRequestException(`No ${dto.billingCycle.toLowerCase()} price for this plan`);
    }

    // ── Coupon validation ──────────────────────────────────────────────────────
    let effectiveFeeRate = planRecord.platformFeeRate;
    let appliedCoupon: { id: string; originalFeeRate: number; discountedFeeRate: number } | null = null;

    if (dto.couponCode) {
      const coupon = await this.prisma.coupon.findUnique({ where: { code: dto.couponCode } });

      if (!coupon || !coupon.isActive) {
        throw new BadRequestException('Invalid or inactive coupon code');
      }
      if (coupon.target !== CouponTarget.HOST) {
        throw new BadRequestException('This coupon is not applicable for host subscriptions');
      }

      const now = new Date();
      if (coupon.validFrom && now < coupon.validFrom) {
        throw new BadRequestException('This coupon is not yet valid');
      }
      if (coupon.validUntil && now > coupon.validUntil) {
        throw new BadRequestException('This coupon has expired');
      }
      if (coupon.maxUsages !== null && coupon.usageCount >= coupon.maxUsages) {
        throw new BadRequestException('This coupon has reached its maximum usage limit');
      }

      if (coupon.maxUsagesPerUser !== null) {
        const userRedemptions = await this.prisma.couponRedemption.count({
          where: { couponId: coupon.id, userId: profile.userId },
        });
        if (userRedemptions >= coupon.maxUsagesPerUser) {
          throw new BadRequestException('You have already used this coupon the maximum number of times');
        }
      }

      const originalRate = planRecord.platformFeeRate;
      const discountedRate =
        coupon.discountType === DiscountType.PERCENTAGE
          ? originalRate * (1 - coupon.discountValue / 100)
          : Math.max(0, originalRate - coupon.discountValue);

      effectiveFeeRate = discountedRate;
      appliedCoupon = { id: coupon.id, originalFeeRate: originalRate, discountedFeeRate: discountedRate };
    }
    // ──────────────────────────────────────────────────────────────────────────

    const amountInPaise = Math.round(price * 100);

    const razorpayResult = await this.subscriptionService.createPlanAndSubscription({
      plan: dto.plan,
      billingCycle: dto.billingCycle,
      amountInPaise,
      hostEmail: profile.user.email,
      hostProfileId: profile.id,
    });

    const newSubscription = await this.prisma.$transaction(async (tx) => {
      await tx.hostSubscription.updateMany({
        where: { hostProfileId: profile.id, status: SubscriptionStatus.ACTIVE },
        data: {
          status: SubscriptionStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelReason: 'UPGRADE',
        },
      });

      const subscription = await tx.hostSubscription.create({
        data: {
          hostProfileId: profile.id,
          plan: dto.plan,
          status: SubscriptionStatus.ACTIVE,
          billingCycle: dto.billingCycle,
          lockedYearlyPrice: planRecord.yearlyPrice,
          lockedMonthlyPrice: planRecord.monthlyPrice,
          lockedFeeRate: effectiveFeeRate,
          razorpaySubscriptionId: razorpayResult.razorpaySubscriptionId,
          razorpayPlanId: razorpayResult.razorpayPlanId,
          currentPeriodStart: razorpayResult.currentPeriodStart,
          currentPeriodEnd: razorpayResult.currentPeriodEnd,
        },
      });

      await tx.hostProfile.update({
        where: { id: profile.id },
        data: { currentPlan: dto.plan },
      });

      if (appliedCoupon) {
        await tx.couponRedemption.create({
          data: {
            couponId: appliedCoupon.id,
            userId: profile.userId,
            hostSubscriptionId: subscription.id,
            originalFeeRate: appliedCoupon.originalFeeRate,
            discountedFeeRate: appliedCoupon.discountedFeeRate,
          },
        });
        await tx.coupon.update({
          where: { id: appliedCoupon.id },
          data: { usageCount: { increment: 1 } },
        });
      }

      return subscription;
    });

    void this.mailQueue.add('subscription-activated', {
      to: profile.user.email,
      hostName: profile.user.firstName,
      plan: dto.plan,
      billingCycle: dto.billingCycle,
    });

    return newSubscription;
  }
}
