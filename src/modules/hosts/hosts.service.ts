import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { BillingCycle, HostPlan, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { KYC_PROVIDER, KycProvider } from './interfaces/kyc-provider.interface';
import { SubscriptionService } from './subscription.service';
import { ApplyHostDto } from './dto/apply-host.dto';
import { UpdateHostProfileDto } from './dto/update-host-profile.dto';
import { SubmitKycDto } from './dto/submit-kyc.dto';
import { KycWebhookDto } from './dto/kyc-webhook.dto';
import { UpgradeSubscriptionDto } from './dto/upgrade-subscription.dto';

@Injectable()
export class HostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cryptoService: CryptoService,
    @Inject(KYC_PROVIDER) private readonly kycProvider: KycProvider,
    private readonly subscriptionService: SubscriptionService,
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
    const profile = await this.prisma.hostProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Host profile not found');

    if (profile.kycStatus === 'PENDING') {
      throw new ConflictException('KYC verification is already in progress');
    }
    if (profile.kycStatus === 'VERIFIED' && profile.approvalStatus !== 'REJECTED') {
      throw new ConflictException('KYC already verified');
    }

    const { referenceId } = await this.kycProvider.initiateVerification(
      profile.id,
      dto.aadhaarNumber,
    );

    await this.prisma.hostProfile.update({
      where: { id: profile.id },
      data: { kycStatus: 'PENDING', kycFailureReason: null },
    });

    return { referenceId };
  }

  async handleKycWebhook(dto: KycWebhookDto) {
    const profile = await this.prisma.hostProfile.findUnique({
      where: { id: dto.hostProfileId },
      include: { user: { select: { email: true, firstName: true } } },
    });
    if (!profile) throw new NotFoundException('Host profile not found');

    if (dto.status === 'VERIFIED') {
      await this.prisma.hostProfile.update({
        where: { id: profile.id },
        data: {
          kycStatus: 'VERIFIED',
          kycVerifiedAt: new Date(),
          kycFailureReason: null,
          ...(dto.maskedAadhaar && { maskedAadhaar: dto.maskedAadhaar }),
        },
      });
    } else {
      await this.prisma.hostProfile.update({
        where: { id: profile.id },
        data: {
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

  async reapply(userId: string) {
    const profile = await this.prisma.hostProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Host profile not found');

    const canReapply =
      profile.kycStatus === 'FAILED' || profile.approvalStatus === 'REJECTED';

    if (!canReapply) {
      throw new BadRequestException(
        'Reapplication is only allowed after a KYC failure or admin rejection',
      );
    }

    return this.prisma.hostProfile.update({
      where: { id: profile.id },
      data: {
        kycStatus: 'NOT_SUBMITTED',
        kycFailureReason: null,
        kycVerifiedAt: null,
        maskedAadhaar: null,
        approvalStatus: 'PENDING',
        rejectionReason: null,
        approvedAt: null,
        approvedBy: null,
      },
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
          lockedFeeRate: planRecord.platformFeeRate,
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
