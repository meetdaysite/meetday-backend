import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { HostsService } from './hosts.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ApplyHostDto } from './dto/apply-host.dto';
import { UpdateHostProfileDto } from './dto/update-host-profile.dto';
import { SubmitKycDto } from './dto/submit-kyc.dto';
import { PanWebhookDto } from './dto/pan-webhook.dto';
import { BankWebhookDto } from './dto/bank-webhook.dto';
import { UpgradeSubscriptionDto } from './dto/upgrade-subscription.dto';

@ApiTags('Hosts')
@ApiBearerAuth('firebase-token')
@ApiUnauthorizedResponse({ description: 'Missing or invalid Firebase JWT' })
@Controller('hosts')
export class HostsController {
  constructor(private readonly hostsService: HostsService) {}

  @Post('apply')
  @UseGuards(RolesGuard)
  @Roles('USER')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Apply to become a host',
    description:
      'Creates a host profile for the authenticated user. ' +
      'The user must have the USER role (not yet a host). ' +
      'KYC verification must be submitted separately after this step. ' +
      'categoryIds must be valid UUIDs from GET /categories.',
  })
  @ApiBody({
    type: ApplyHostDto,
    examples: {
      minimal: {
        summary: 'Minimal — required fields only',
        value: {
          hostType: 'INDIVIDUAL',
          categoryIds: ['11111111-1111-1111-1111-111111111111'],
        },
      },
      full: {
        summary: 'Full application',
        value: {
          hostType: 'INDIVIDUAL',
          displayName: 'Mumbai Walks by Rahul',
          legalName: 'Rahul Sharma',
          pan: 'ABCDE1234F',
          hostBio: 'I run weekly photography walks across Mumbai exploring hidden heritage.',
          tagline: 'Discover Mumbai through a lens',
          languages: ['English', 'Hindi', 'Marathi'],
          yearsOfExperience: 3,
          totalEventsPreviouslyHosted: 25,
          operatingCities: ['Mumbai', 'Pune', 'Nashik'],
          portfolioLinks: ['https://insider.in/mumbai-walks'],
          categoryIds: [
            '11111111-1111-1111-1111-111111111111',
            '22222222-2222-2222-2222-222222222222',
          ],
          socialLinks: {
            instagram: 'https://instagram.com/mumbaiwalks',
            website: 'https://mumbaiwalks.in',
          },
          address: {
            addressLine1: '12, Linking Road',
            addressLine2: 'Bandra West',
            city: 'Mumbai',
            state: 'Maharashtra',
            pincode: '400050',
          },
        },
      },
      business: {
        summary: 'Business host',
        value: {
          hostType: 'BUSINESS',
          displayName: 'Priya Eats',
          legalName: 'Priya Nair Events Pvt Ltd',
          pan: 'FGHIJ5678K',
          hostBio: 'We curate premium food experiences across Bengaluru.',
          tagline: 'Eat. Explore. Repeat.',
          languages: ['English', 'Kannada'],
          categoryIds: ['33333333-3333-3333-3333-333333333333'],
          address: {
            addressLine1: '5th Floor, Prestige Tower',
            city: 'Bengaluru',
            state: 'Karnataka',
            pincode: '560001',
          },
        },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'Host profile created. kycStatus is NOT_SUBMITTED — submit KYC next.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-04-07T10:00:00.000Z',
        data: {
          id: 'hp-uuid',
          userId: 'user-uuid',
          hostType: 'INDIVIDUAL',
          displayName: 'Mumbai Walks by Rahul',
          legalName: 'Rahul Sharma',
          hostBio: 'I run weekly photography walks across Mumbai.',
          tagline: 'Discover Mumbai through a lens',
          languages: ['English', 'Hindi'],
          yearsOfExperience: 3,
          totalEventsPreviouslyHosted: 25,
          operatingCities: ['Mumbai', 'Pune'],
          kycStatus: 'NOT_SUBMITTED',
          approvalStatus: 'PENDING',
          currentPlan: 'DISCOVER',
          categories: [{ category: { id: 'cat-uuid', name: 'Outdoor Adventures' } }],
          address: {
            id: 'addr-uuid',
            addressLine1: '12, Linking Road',
            addressLine2: 'Bandra West',
            city: 'Mumbai',
            state: 'Maharashtra',
            pincode: '400050',
            country: 'India',
          },
          createdAt: '2026-04-08T10:00:00.000Z',
          updatedAt: '2026-04-08T10:00:00.000Z',
        },
      },
    },
  })
  @ApiConflictResponse({ description: 'A host profile already exists for this user.' })
  @ApiBadRequestResponse({ description: 'One or more categoryIds are invalid UUIDs or do not exist.' })
  applyAsHost(@GetUser('id') userId: string, @Body() dto: ApplyHostDto) {
    return this.hostsService.applyAsHost(userId, dto);
  }

  @Get('me')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @ApiOperation({
    summary: 'Get own host profile',
    description: 'Returns the authenticated host\'s profile including categories and latest subscription.',
  })
  @ApiOkResponse({
    description: 'Host profile with categories and latest subscription.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-04-07T10:00:00.000Z',
        data: {
          id: 'hp-uuid',
          userId: 'user-uuid',
          hostType: 'INDIVIDUAL',
          displayName: 'Mumbai Walks by Rahul',
          legalName: 'Rahul Sharma',
          kycStatus: 'VERIFIED',
          panVerificationStatus: 'VERIFIED',
          bankVerificationStatus: 'VERIFIED',
          approvalStatus: 'APPROVED',
          currentPlan: 'SELL',
          yearsOfExperience: 3,
          totalEventsPreviouslyHosted: 25,
          operatingCities: ['Mumbai', 'Pune'],
          address: {
            addressLine1: '12, Linking Road',
            city: 'Mumbai',
            state: 'Maharashtra',
            pincode: '400050',
            country: 'India',
          },
          categories: [{ category: { id: 'cat-uuid', name: 'Outdoor Adventures' } }],
          subscriptions: [
            {
              id: 'sub-uuid',
              plan: 'SELL',
              status: 'ACTIVE',
              billingCycle: 'YEARLY',
              currentPeriodStart: '2026-04-08T00:00:00.000Z',
              currentPeriodEnd: '2027-04-08T00:00:00.000Z',
            },
          ],
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'No host profile found for this user.' })
  getOwnHostProfile(@GetUser('id') userId: string) {
    return this.hostsService.getOwnHostProfile(userId);
  }

  @Patch('profile')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @ApiOperation({
    summary: 'Update host profile',
    description:
      'Partially updates the host profile. All fields are optional. ' +
      'If categoryIds is provided, it replaces all existing categories entirely.',
  })
  @ApiBody({
    type: UpdateHostProfileDto,
    examples: {
      updateBio: {
        summary: 'Update bio and tagline',
        value: {
          hostBio: 'Updated bio text here.',
          tagline: 'New tagline',
        },
      },
      updateAddress: {
        summary: 'Update or set address',
        value: {
          address: {
            addressLine1: '10, MG Road',
            city: 'Bengaluru',
            state: 'Karnataka',
            pincode: '560001',
          },
        },
      },
      updateExperience: {
        summary: 'Update experience fields',
        value: {
          yearsOfExperience: 5,
          totalEventsPreviouslyHosted: 40,
          operatingCities: ['Mumbai', 'Pune', 'Goa'],
          portfolioLinks: ['https://insider.in/event-1', 'https://youtu.be/xyz'],
        },
      },
      replaceCategories: {
        summary: 'Replace all categories',
        value: {
          categoryIds: [
            '33333333-3333-3333-3333-333333333333',
            '44444444-4444-4444-4444-444444444444',
          ],
        },
      },
    },
  })
  @ApiOkResponse({ description: 'Updated host profile with new categories.' })
  @ApiNotFoundResponse({ description: 'No host profile found for this user.' })
  @ApiBadRequestResponse({ description: 'One or more categoryIds are invalid.' })
  updateHostProfile(@GetUser('id') userId: string, @Body() dto: UpdateHostProfileDto) {
    return this.hostsService.updateHostProfile(userId, dto);
  }

  @Post('kyc/submit')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit KYC for verification',
    description:
      'Initiates PAN verification (via KYC provider) and bank account penny drop (via Razorpay) simultaneously. ' +
      'Raw account number is never stored — only the last 4 digits are persisted. ' +
      'kycStatus becomes PENDING. Both verifications must succeed for kycStatus to become VERIFIED. ' +
      'Results are delivered asynchronously via POST /hosts/kyc/pan-webhook and POST /hosts/kyc/bank-webhook.',
  })
  @ApiBody({
    type: SubmitKycDto,
    examples: {
      default: {
        summary: 'Submit bank account for verification',
        value: {
          bankAccount: {
            accountNumber: '1234567890',
            ifscCode: 'HDFC0001234',
            accountHolderName: 'Rahul Sharma',
            accountType: 'SAVINGS',
          },
        },
      },
    },
  })
  @ApiOkResponse({
    description: 'KYC initiated. Awaiting PAN and bank verification webhooks.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-04-13T10:00:00.000Z',
        data: {
          panReferenceId: 'KYC-PAN-STUB-a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          pennyDropReference: 'PENNY-STUB-b2c3d4e5-f6a7-8901-bcde-f12345678901',
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Host profile not found.' })
  @ApiConflictResponse({ description: 'KYC is already in progress or already verified.' })
  submitKyc(@GetUser('id') userId: string, @Body() dto: SubmitKycDto) {
    return this.hostsService.submitKyc(userId, dto);
  }

  @Post('kyc/pan-webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'PAN KYC provider async webhook',
    description:
      'Not invoked by the current Sandbox integration (synchronous — result processed inline). ' +
      'Retained for async provider compatibility. ' +
      'On VERIFIED: panVerificationStatus is set to VERIFIED. If penny drop has also succeeded, kycStatus becomes VERIFIED. ' +
      'On FAILED: kycStatus is set to FAILED and a failure email is sent to the host.',
    deprecated: true,
  })
  @ApiBody({
    type: PanWebhookDto,
    examples: {
      verified: {
        summary: 'PAN verification passed',
        value: {
          referenceId: 'KYC-PAN-STUB-a1b2c3d4',
          hostProfileId: 'hp-uuid',
          status: 'VERIFIED',
        },
      },
      failed: {
        summary: 'PAN verification failed',
        value: {
          referenceId: 'KYC-PAN-STUB-a1b2c3d4',
          hostProfileId: 'hp-uuid',
          status: 'FAILED',
          failureReason: 'PAN not found in ITD database',
        },
      },
    },
  })
  @ApiOkResponse({ description: 'Webhook processed.' })
  @ApiNotFoundResponse({ description: 'hostProfileId does not match any host profile.' })
  handlePanWebhook(@Body() dto: PanWebhookDto) {
    return this.hostsService.handlePanWebhook(dto);
  }

  @Post('kyc/bank-webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Razorpay penny drop webhook',
    description:
      'Called by Razorpay when the penny drop verification for a bank account completes. This endpoint is public (no auth). ' +
      'In production this must be secured with Razorpay webhook signature validation. ' +
      'On SUCCESS: payoutAccount.status becomes PENDING_ADMIN_REVIEW. If PAN has also been verified, kycStatus becomes VERIFIED. ' +
      'On FAILED: payoutAccount.status becomes PENNY_DROP_FAILED, kycStatus becomes FAILED and a failure email is sent.',
  })
  @ApiBody({
    type: BankWebhookDto,
    examples: {
      success: {
        summary: 'Penny drop passed',
        value: {
          pennyDropReference: 'penny_abc123xyz',
          hostPayoutAccountId: 'payout-uuid',
          status: 'SUCCESS',
          bankName: 'HDFC Bank',
        },
      },
      failed: {
        summary: 'Penny drop failed',
        value: {
          pennyDropReference: 'penny_abc123xyz',
          hostPayoutAccountId: 'payout-uuid',
          status: 'FAILED',
          failureReason: 'Account not found',
        },
      },
    },
  })
  @ApiOkResponse({ description: 'Webhook processed.' })
  @ApiNotFoundResponse({ description: 'hostPayoutAccountId does not match any payout account.' })
  handleBankWebhook(@Body() dto: BankWebhookDto) {
    return this.hostsService.handleBankWebhook(dto);
  }

  @Post('reapply')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reapply after KYC failure or admin rejection',
    description:
      'Resets KYC and approval state so the host can resubmit. ' +
      'Allowed only when kycStatus is FAILED or approvalStatus is REJECTED. ' +
      'After reapply, the host must submit KYC again via POST /hosts/kyc/submit.',
  })
  @ApiOkResponse({
    description: 'Host profile reset to initial state.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-04-07T10:00:00.000Z',
        data: {
          id: 'hp-uuid',
          kycStatus: 'NOT_SUBMITTED',
          panVerificationStatus: 'NOT_SUBMITTED',
          bankVerificationStatus: 'NOT_SUBMITTED',
          approvalStatus: 'PENDING',
          kycFailureReason: null,
          rejectionReason: null,
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Host profile not found.' })
  @ApiBadRequestResponse({ description: 'Reapplication not allowed — KYC is not failed and approval is not rejected.' })
  reapply(@GetUser('id') userId: string) {
    return this.hostsService.reapply(userId);
  }

  @Get('subscription/plans')
  @Public()
  @ApiOperation({
    summary: 'List available subscription plans',
    description:
      'Returns all active subscription plans. No authentication required. ' +
      'Prices are in INR. DISCOVER is free (null prices). ' +
      'SELL is yearly-only. COMMUNITY supports both monthly and yearly billing.',
  })
  @ApiOkResponse({
    description: 'List of active subscription plans.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-04-07T10:00:00.000Z',
        data: [
          {
            id: 'plan-uuid-1',
            plan: 'COMMUNITY',
            yearlyPrice: 10000.0,
            monthlyPrice: 1250.0,
            platformFeeRate: 0.15,
            isActive: true,
          },
          {
            id: 'plan-uuid-2',
            plan: 'DISCOVER',
            yearlyPrice: null,
            monthlyPrice: null,
            platformFeeRate: 0.2,
            isActive: true,
          },
          {
            id: 'plan-uuid-3',
            plan: 'SELL',
            yearlyPrice: 8300.0,
            monthlyPrice: null,
            platformFeeRate: 0.15,
            isActive: true,
          },
        ],
      },
    },
  })
  getSubscriptionPlans() {
    return this.hostsService.getSubscriptionPlans();
  }

  @Post('subscription/upgrade')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Upgrade to a paid subscription plan',
    description:
      'Creates a Razorpay subscription and upgrades the host plan. ' +
      'The host must be approved (approvalStatus = APPROVED). ' +
      'Any existing active subscription is cancelled at cycle end before the new one is created. ' +
      'Constraints: SELL plan is yearly-only (MONTHLY billing is rejected). ' +
      'A subscription activation email is sent to the host.',
  })
  @ApiBody({
    type: UpgradeSubscriptionDto,
    examples: {
      sellYearly: {
        summary: 'Upgrade to SELL (yearly only)',
        value: { plan: 'SELL', billingCycle: 'YEARLY' },
      },
      communityMonthly: {
        summary: 'Upgrade to COMMUNITY monthly',
        value: { plan: 'COMMUNITY', billingCycle: 'MONTHLY' },
      },
      communityYearly: {
        summary: 'Upgrade to COMMUNITY yearly',
        value: { plan: 'COMMUNITY', billingCycle: 'YEARLY' },
      },
    },
  })
  @ApiOkResponse({
    description: 'Subscription created and host plan updated.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-04-07T10:00:00.000Z',
        data: {
          id: 'sub-uuid',
          hostProfileId: 'hp-uuid',
          plan: 'SELL',
          status: 'ACTIVE',
          billingCycle: 'YEARLY',
          lockedYearlyPrice: 8300.0,
          lockedFeeRate: 0.15,
          razorpaySubscriptionId: 'sub_xyz123',
          razorpayPlanId: 'plan_abc456',
          currentPeriodStart: '2026-04-07T00:00:00.000Z',
          currentPeriodEnd: '2027-04-07T00:00:00.000Z',
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Host profile or subscription plan not found.' })
  @ApiForbiddenResponse({ description: 'Host is not approved yet.' })
  @ApiBadRequestResponse({ description: 'SELL plan cannot use MONTHLY billing, or no price configured for the selected billing cycle.' })
  upgradeSubscription(@GetUser('id') userId: string, @Body() dto: UpgradeSubscriptionDto) {
    return this.hostsService.upgradeSubscription(userId, dto);
  }
}
