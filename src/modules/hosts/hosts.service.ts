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
import { VerifyBankDto } from './dto/submit-kyc.dto';
import { PanWebhookDto } from './dto/pan-webhook.dto';
import { BankWebhookDto } from './dto/bank-webhook.dto';
import { UpgradeSubscriptionDto } from './dto/upgrade-subscription.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../../common/storage/storage.service';

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
    private readonly notificationsService: NotificationsService,
    private readonly storageService: StorageService,
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

    const hostProfile = await this.prisma.$transaction(async (tx) => {
      const profile = await tx.hostProfile.create({
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
          gender: dto.gender,
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

      return profile;
    });

    void this.notificationsService.create(
      userId,
      'host_applied',
      'Application Submitted',
      'Your host application is under review. We\'ll notify you once a decision is made.',
    ).catch((err) => this.logger.error('Failed to create host_applied notification', err));

    return hostProfile;
  }

  async getOwnHostProfile(userId: string) {
    const profile = await this.prisma.hostProfile.findUnique({
      where: { userId },
      include: {
        categories: { include: { category: true } },
        address: true,
        subscriptions: { orderBy: { createdAt: 'desc' }, take: 1 },
        user: { select: { avatarUrl: true } },
      },
    });
    if (!profile) throw new NotFoundException('Host profile not found');

    const { panEncrypted, user, ...rest } = profile;
    const avatarUrl = user.avatarUrl
      ? await this.storageService.getPresignedDownloadUrl(user.avatarUrl)
      : null;

    return {
      ...rest,
      pan: panEncrypted ? this.cryptoService.decrypt(panEncrypted) : null,
      avatarUrl,
    };
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

    const { categoryIds: _, address, pan, avatarUrl, ...fields } = dto;

    if (avatarUrl !== undefined) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { avatarUrl },
      });
    }

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
        ...(fields.gender !== undefined && { gender: fields.gender }),
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

  async verifyPanOnly(userId: string) {
    const profile = await this.prisma.hostProfile.findUnique({
      where: { userId },
      include: { user: { select: { email: true, firstName: true } } },
    });
    if (!profile) throw new NotFoundException('Host profile not found');

    if (!profile.panEncrypted) {
      throw new BadRequestException(
        'PAN is required before verification. Please update your profile with your PAN first.',
      );
    }
    if (!profile.legalName) {
      throw new BadRequestException(
        'Legal name is required before PAN verification. Please update your profile.',
      );
    }
    if (profile.panVerificationStatus === 'VERIFIED') {
      throw new ConflictException('PAN is already verified');
    }

    const decryptedPan = this.cryptoService.decrypt(profile.panEncrypted!);
    const panResult = await this.kycProvider.initiateVerification(
      profile.id,
      decryptedPan,
      profile.legalName,
    );

    await this.prisma.hostProfile.update({
      where: { id: profile.id },
      data: { panVerificationReference: panResult.referenceId },
    });

    // Sandbox is synchronous — process the result immediately.
    // Async providers leave verificationStatus undefined and rely on the webhook instead.
    // Unlike verifyBank, this method never touches kycStatus — that belongs to verifyBank.
    if (panResult.verificationStatus !== undefined) {
      if (panResult.verificationStatus === 'VERIFIED') {
        await this.prisma.hostProfile.update({
          where: { id: profile.id },
          data: { panVerificationStatus: 'VERIFIED' },
        });
      } else {
        await this.prisma.hostProfile.update({
          where: { id: profile.id },
          data: {
            panVerificationStatus: 'FAILED',
            kycFailureReason: panResult.failureReason ?? null,
          },
        });
        void this.mailQueue.add('kyc-failed', {
          to: profile.user.email,
          hostName: profile.user.firstName,
          reason: panResult.failureReason ?? null,
        }).catch((err) => this.logger.error('Failed to queue kyc-failed mail', err));
        void this.notificationsService.create(
          userId,
          'kyc_failed',
          'PAN Verification Failed',
          `PAN verification failed.${panResult.failureReason ? ` ${panResult.failureReason}` : ''}`,
        ).catch((err) => this.logger.error('Failed to create kyc_failed notification', err));
      }
    }

    return {
      referenceId: panResult.referenceId,
      panVerificationStatus: panResult.verificationStatus ?? 'PENDING',
      failureReason: panResult.failureReason ?? null,
    };
  }

  async verifyBank(userId: string, dto: VerifyBankDto) {
    const profile = await this.prisma.hostProfile.findUnique({
      where: { userId },
      include: { payoutAccount: true, user: { select: { email: true, firstName: true, phone: true } } },
    });
    if (!profile) throw new NotFoundException('Host profile not found');

    if (!profile.panEncrypted) {
      throw new BadRequestException(
        'PAN is required before bank verification. Please update your profile with your PAN first.',
      );
    }

    if (!profile.legalName) {
      throw new BadRequestException(
        'Legal name is required before bank verification. Please update your profile.',
      );
    }

    if (profile.kycStatus === 'VERIFIED' && profile.approvalStatus !== 'REJECTED') {
      throw new ConflictException('KYC already verified');
    }

    const panAlreadyVerified = profile.panVerificationStatus === 'VERIFIED';
    const maskedAccountNumber = 'XXXX' + dto.bankAccount.accountNumber.slice(-4);
    const existingPayout = profile.payoutAccount;
    let newPayoutAccountId: string;

    await this.prisma.$transaction(async (tx) => {
      // Don't reset PAN fields if PAN was pre-verified via /kyc/pan/verify
      await tx.hostProfile.update({
        where: { id: profile.id },
        data: {
          ...(!panAlreadyVerified && {
            panVerificationStatus: 'PENDING',
            panVerificationReference: null,
          }),
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

      // Create new payout account — bankName from user input; overwritten by Razorpay on success
      const created = await tx.hostPayoutAccount.create({
        data: {
          hostProfileId: profile.id,
          maskedAccountNumber,
          accountHolderName: dto.bankAccount.accountHolderName,
          bankName: dto.bankAccount.bankName,
          status: 'PENDING_PENNY_DROP',
          pennyDropInitiatedAt: new Date(),
          kycStatusAtSubmission: 'PENDING',
        },
      });
      newPayoutAccountId = created.id;
    });

    // --- PAN verification ---
    // Skip if PAN was pre-verified via POST /hosts/kyc/pan/verify; run inline otherwise.
    let panReferenceId: string;

    if (panAlreadyVerified) {
      panReferenceId = profile.panVerificationReference!;
    } else {
      // Decrypt stored PAN to pass to KYC provider — discarded immediately after the call
      const decryptedPan = this.cryptoService.decrypt(profile.panEncrypted!);
      const panResult = await this.kycProvider.initiateVerification(
        profile.id,
        decryptedPan,
        profile.legalName,
      );
      panReferenceId = panResult.referenceId;
      await this.prisma.hostProfile.update({
        where: { id: profile.id },
        data: { panVerificationReference: panResult.referenceId },
      });

      // Sandbox is synchronous — process the result immediately.
      // Async providers leave verificationStatus undefined and rely on the webhook instead.
      if (panResult.verificationStatus !== undefined) {
        await this.applyPanVerificationResult(
          { id: profile.id, userId: profile.userId, payoutAccount: { status: 'PENDING_PENNY_DROP' }, user: profile.user },
          panResult.verificationStatus,
          panResult.failureReason,
        );
      }

      // Skip bank verification if PAN already failed synchronously — prevents a duplicate kyc-failed
      // email for the same submission. Async providers (verificationStatus === undefined) always proceed.
      if (panResult.verificationStatus === 'FAILED') {
        void this.notificationsService.create(
          userId,
          'kyc_submitted',
          'KYC Under Review',
          'Your KYC documents have been submitted and are being verified.',
        ).catch((err) => this.logger.error('Failed to create kyc_submitted notification', err));

        const failedProfile = await this.prisma.hostProfile.findUnique({
          where: { id: profile.id },
          select: { kycStatus: true, panVerificationStatus: true, bankVerificationStatus: true, kycFailureReason: true },
        });
        return {
          panReferenceId,
          pennyDropReference: null,
          kycStatus: failedProfile!.kycStatus,
          panVerificationStatus: failedProfile!.panVerificationStatus,
          bankVerificationStatus: failedProfile!.bankVerificationStatus,
          kycFailureReason: failedProfile!.kycFailureReason ?? null,
        };
      }
    }

    // --- Bank verification ---
    const bankResult = await this.pennyDropService.initiatePennyDrop(
      newPayoutAccountId!,
      dto.bankAccount.accountNumber,
      dto.bankAccount.ifscCode,
      dto.bankAccount.accountHolderName,
      profile.user.phone ?? '',
    );
    const pennyDropReference = bankResult.pennyDropReference;
    await this.prisma.hostPayoutAccount.update({
      where: { id: newPayoutAccountId! },
      data: { pennyDropReference: bankResult.pennyDropReference },
    });

    // Sandbox is synchronous — process the result immediately.
    // Async providers leave verificationStatus undefined and rely on the webhook instead.
    if (bankResult.verificationStatus !== undefined) {
      // Use panAlreadyVerified flag rather than the stale profile.panVerificationStatus
      // (which was reset to PENDING in the transaction above if PAN wasn't pre-verified).
      const effectivePanStatus = panAlreadyVerified ? 'VERIFIED' : (profile.panVerificationStatus as string);
      await this.applyBankVerificationResult(
        newPayoutAccountId!,
        { ...profile, panVerificationStatus: effectivePanStatus },
        bankResult.verificationStatus,
        bankResult.bankName,
        bankResult.failureReason,
      );
    }

    void this.notificationsService.create(
      userId,
      'kyc_submitted',
      'KYC Under Review',
      'Your KYC documents have been submitted and are being verified.',
    ).catch((err) => this.logger.error('Failed to create kyc_submitted notification', err));

    // Re-read the updated profile to include synchronous verification results in the response.
    // For async providers the statuses remain PENDING — accurate until webhooks arrive.
    const updatedProfile = await this.prisma.hostProfile.findUnique({
      where: { id: profile.id },
      select: { kycStatus: true, panVerificationStatus: true, bankVerificationStatus: true, kycFailureReason: true },
    });

    return {
      panReferenceId,
      pennyDropReference,
      kycStatus: updatedProfile!.kycStatus,
      panVerificationStatus: updatedProfile!.panVerificationStatus,
      bankVerificationStatus: updatedProfile!.bankVerificationStatus,
      kycFailureReason: updatedProfile!.kycFailureReason ?? null,
    };
  }

  private async applyPanVerificationResult(
    profile: {
      id: string;
      userId: string;
      payoutAccount: { status: string } | null;
      user: { email: string; firstName: string };
    },
    status: 'VERIFIED' | 'FAILED',
    failureReason?: string,
  ): Promise<void> {
    if (status === 'VERIFIED') {
      const updateData: Record<string, unknown> = {
        panVerificationStatus: 'VERIFIED',
        kycFailureReason: null,
      };

      // If penny drop has also succeeded, both legs are done → kycStatus VERIFIED
      if (profile.payoutAccount?.status === 'PENDING_ADMIN_REVIEW') {
        updateData.kycStatus = 'VERIFIED';
        updateData.kycVerifiedAt = new Date();
        void this.notificationsService.create(
          profile.userId,
          'kyc_verified',
          'KYC Verified',
          'Your identity and bank account have been verified. Your application is pending admin approval.',
        ).catch((err) => this.logger.error('Failed to create kyc_verified notification', err));
      }

      await this.prisma.hostProfile.update({ where: { id: profile.id }, data: updateData });
    } else {
      await this.prisma.hostProfile.update({
        where: { id: profile.id },
        data: {
          panVerificationStatus: 'FAILED',
          kycStatus: 'FAILED',
          kycFailureReason: failureReason ?? null,
        },
      });
      void this.mailQueue.add('kyc-failed', {
        to: profile.user.email,
        hostName: profile.user.firstName,
        reason: failureReason ?? null,
      }).catch((err) => this.logger.error('Failed to queue kyc-failed mail', err));
      void this.notificationsService.create(
        profile.userId,
        'kyc_failed',
        'KYC Verification Failed',
        `PAN verification failed.${failureReason ? ` ${failureReason}` : ''}`,
      ).catch((err) => this.logger.error('Failed to create kyc_failed notification', err));
    }
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
    await this.applyPanVerificationResult(profile, dto.status, dto.failureReason);
  }

  private async applyBankVerificationResult(
    payoutAccountId: string,
    profile: {
      id: string;
      userId: string;
      panVerificationStatus: string;
      user: { email: string; firstName: string };
    },
    status: 'VERIFIED' | 'FAILED',
    bankName?: string,
    failureReason?: string,
  ): Promise<void> {
    if (status === 'VERIFIED') {
      await this.prisma.hostPayoutAccount.update({
        where: { id: payoutAccountId },
        data: {
          status: 'PENDING_ADMIN_REVIEW',
          bankName: bankName ?? null,
          pennyDropCompletedAt: new Date(),
          pennyDropFailReason: null,
        },
      });

      await this.prisma.hostPayoutAccountHistory.create({
        data: {
          hostPayoutAccountId: payoutAccountId,
          previousStatus: 'PENDING_PENNY_DROP',
          newStatus: 'PENDING_ADMIN_REVIEW',
          changeReason: 'PENNY_DROP_SUCCESS',
        },
      });

      // If PAN has also been verified, both legs are done → kycStatus VERIFIED
      const profileUpdate: Record<string, unknown> = { bankVerificationStatus: 'VERIFIED' };
      if (profile.panVerificationStatus === 'VERIFIED') {
        profileUpdate.kycStatus = 'VERIFIED';
        profileUpdate.kycVerifiedAt = new Date();
        void this.notificationsService.create(
          profile.userId,
          'kyc_verified',
          'KYC Verified',
          'Your identity and bank account have been verified. Your application is pending admin approval.',
        ).catch((err) => this.logger.error('Failed to create kyc_verified notification', err));
      }
      await this.prisma.hostProfile.update({ where: { id: profile.id }, data: profileUpdate });
    } else {
      await this.prisma.hostPayoutAccount.update({
        where: { id: payoutAccountId },
        data: {
          status: 'PENNY_DROP_FAILED',
          pennyDropFailReason: failureReason ?? null,
          pennyDropCompletedAt: new Date(),
        },
      });

      await this.prisma.hostPayoutAccountHistory.create({
        data: {
          hostPayoutAccountId: payoutAccountId,
          previousStatus: 'PENDING_PENNY_DROP',
          newStatus: 'PENNY_DROP_FAILED',
          changeReason: 'PENNY_DROP_FAILED',
        },
      });

      await this.prisma.hostProfile.update({
        where: { id: profile.id },
        data: {
          bankVerificationStatus: 'FAILED',
          kycStatus: 'FAILED',
          kycFailureReason: failureReason
            ? `Bank account verification failed: ${failureReason}`
            : 'Bank account verification failed',
        },
      });

      void this.mailQueue.add('kyc-failed', {
        to: profile.user.email,
        hostName: profile.user.firstName,
        reason: failureReason ?? null,
      }).catch((err) => this.logger.error('Failed to queue kyc-failed mail', err));
      void this.notificationsService.create(
        profile.userId,
        'kyc_failed',
        'Bank Verification Failed',
        `Bank account verification failed.${failureReason ? ` ${failureReason}` : ''}`,
      ).catch((err) => this.logger.error('Failed to create kyc_failed notification', err));
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

    await this.applyBankVerificationResult(
      payoutAccount.id,
      payoutAccount.hostProfile,
      dto.status === 'SUCCESS' ? 'VERIFIED' : 'FAILED',
      dto.bankName,
      dto.failureReason,
    );
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
    }).catch((err) => this.logger.error('Failed to queue subscription-activated mail', err));
    void this.notificationsService.create(
      profile.userId,
      'subscription_activated',
      'Subscription Activated',
      `You're now on the ${dto.plan} plan (${dto.billingCycle}).`,
      { plan: dto.plan, billingCycle: dto.billingCycle },
    ).catch((err) => this.logger.error('Failed to create subscription_activated notification', err));

    return newSubscription;
  }
}
