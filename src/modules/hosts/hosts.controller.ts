import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  RawBody,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExcludeEndpoint,
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
import { ActivateCommunityDto } from './dto/activate-community.dto';
import { VerifyBankDto } from './dto/submit-kyc.dto';
import { BankWebhookDto } from './dto/bank-webhook.dto';
import { UpgradeSubscriptionDto } from './dto/upgrade-subscription.dto';
import { DashboardQueryDto } from './dto/dashboard-query.dto';
import { InviteTeamMemberDto } from '../../common/team-access/dto/invite-team-member.dto';

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

  @Get('me/dashboard')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @ApiOperation({
    summary: 'Host dashboard summary',
    description:
      'Returns all data needed for the host dashboard in a single call: ' +
      'event status counts, overview stats with period deltas, the 5 most recently updated events, ' +
      'and the 5 most recent notifications. ' +
      'The `period` query param controls the window for overview stats and their % change vs the preceding equivalent window. ' +
      'ALL_TIME skips date filters and returns null for all delta fields. ' +
      '"completed" in eventCounts is the persisted COMPLETED status (a completion cron flips PUBLISHED events once they end). ' +
      'recentEvents[].status is a display status that may also be LIVE while an event is in progress.',
  })
  @ApiOkResponse({
    description: 'Dashboard summary for the authenticated host.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-05-18T10:00:00.000Z',
        data: {
          eventCounts: { draft: 2, underReview: 1, published: 3, completed: 5, cancelled: 1 },
          overview: {
            period: 'THIS_MONTH',
            totalEvents: 4,
            totalEventsDelta: 33,
            liveRegistrations: 312,
            liveRegistrationsDelta: 18,
            revenue: 51620,
            revenueDelta: 24,
            avgSatisfaction: 4.7,
            avgSatisfactionDelta: 0.3,
          },
          recentEvents: [
            {
              id: 'evt-uuid',
              title: 'Summer Music Festival',
              coverImageUrl: 'https://cdn.example.com/signed-url',
              city: 'Austin',
              eventDate: '2025-06-21T00:00:00.000Z',
              endDate: '2025-06-22T00:00:00.000Z',
              endTime: '23:00',
              status: 'PUBLISHED',
              registrations: 1248,
              revenue: 24560,
            },
          ],
          recentNotifications: [
            {
              id: 'notif-uuid',
              type: 'event_approved',
              title: 'Summer Music Festival was approved',
              body: 'Your event is now live.',
              isRead: false,
              createdAt: '2026-05-18T09:45:00.000Z',
            },
          ],
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Host profile not found.' })
  getDashboard(@GetUser('id') userId: string, @Query() query: DashboardQueryDto) {
    return this.hostsService.getDashboard(userId, query.period);
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

  @Get('community')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @ApiOperation({ summary: "Get the host's community profile (for sponsorship proposals)" })
  @ApiOkResponse({ description: 'Community profile, or null if not activated yet.' })
  getCommunityProfile(@GetUser('id') userId: string) {
    return this.hostsService.getCommunityProfile(userId);
  }

  @Post('community')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @ApiOperation({
    summary: 'Activate or update the community profile',
    description: 'Upserts the community profile shown to potential sponsors. logoKey comes from POST /storage/upload-url (SPONSORSHIP_MEDIA context).',
  })
  @ApiOkResponse({ description: 'The activated/updated community profile.' })
  @ApiBadRequestResponse({ description: 'One or more categoryIds are invalid.' })
  activateCommunityProfile(@GetUser('id') userId: string, @Body() dto: ActivateCommunityDto) {
    return this.hostsService.activateCommunityProfile(userId, dto);
  }

  @Delete('community')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deactivate (delete) the community profile' })
  deactivateCommunityProfile(@GetUser('id') userId: string) {
    return this.hostsService.deactivateCommunityProfile(userId);
  }

  @Get('community/members')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @ApiOperation({ summary: "List the community's team members (owner + invited members), name + email visible to everyone" })
  @ApiOkResponse({ description: 'Array of members, owner first.' })
  listTeamMembers(@GetUser('id') userId: string) {
    return this.hostsService.listTeamMembers(userId);
  }

  @Post('community/members')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @ApiOperation({
    summary: 'Invite a new team member by email',
    description: 'Any existing member (owner or active member) can invite someone by email. The invite is auto-matched on signup and grants full dashboard access.',
  })
  @ApiOkResponse({ description: 'The created/updated (pending) team member invite.' })
  @ApiConflictResponse({ description: 'This email is already a member, or is the owner\'s own email.' })
  inviteTeamMember(@GetUser('id') userId: string, @Body() dto: InviteTeamMemberDto) {
    return this.hostsService.inviteTeamMember(userId, dto.email);
  }

  @Delete('community/members/:id')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a team member (or cancel a pending invite)',
    description:
      'Deletes the invite/membership row entirely — the invite email already sent can\'t be ' +
      'unsent, but the removed email can no longer be used to join this community afterward.',
  })
  removeTeamMember(@GetUser('id') userId: string, @Param('id') memberId: string) {
    return this.hostsService.removeTeamMember(userId, memberId);
  }

  @Post('kyc/pan/verify')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify PAN (standalone)',
    description:
      'Verifies the PAN already stored on the host profile via the KYC provider. ' +
      'Must be called after saving legalName and pan via PATCH /hosts/profile. ' +
      'On success, panVerificationStatus becomes VERIFIED. ' +
      'The host can then call POST /hosts/kyc/bank/verify without re-running PAN. ' +
      'kycStatus is not updated here — it is managed by POST /hosts/kyc/bank/verify.',
  })
  @ApiOkResponse({
    description: 'PAN verification result.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-05-12T10:00:00.000Z',
        data: {
          referenceId: 'KYC-PAN-STUB-a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          panVerificationStatus: 'VERIFIED',
          failureReason: null,
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'PAN or legal name not set on profile.' })
  @ApiConflictResponse({ description: 'PAN is already verified.' })
  @ApiNotFoundResponse({ description: 'Host profile not found.' })
  verifyPan(@GetUser('id') userId: string) {
    return this.hostsService.verifyPanOnly(userId);
  }

  @Post('kyc/bank/verify')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify bank account (penny drop)',
    description:
      'Verifies the host\'s bank account via Razorpay penny drop. ' +
      'If PAN was pre-verified via POST /hosts/kyc/pan/verify, the PAN step is skipped. ' +
      'Otherwise PAN is verified inline before bank verification runs. ' +
      'Raw account number is never stored — only the last 4 digits are persisted. ' +
      'kycStatus becomes PENDING. Both PAN and bank must be VERIFIED for kycStatus to become VERIFIED.',
  })
  @ApiBody({
    type: VerifyBankDto,
    examples: {
      default: {
        summary: 'Submit bank account for verification',
        value: {
          bankAccount: {
            accountNumber: '1234567890',
            ifscCode: 'HDFC0001234',
            accountHolderName: 'Rahul Sharma',
            bankName: 'HDFC Bank',
          },
        },
      },
    },
  })
  @ApiOkResponse({
    description:
      'Bank verification initiated. For the Sandbox provider (synchronous) the response already reflects the outcome. ' +
      'For async providers, statuses remain PENDING until webhooks arrive. ' +
      'pennyDropReference is null when PAN failed synchronously (bank step skipped to avoid a duplicate failure email).',
    schema: {
      example: {
        success: true,
        timestamp: '2026-05-12T10:00:00.000Z',
        data: {
          panReferenceId: 'KYC-PAN-STUB-a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          pennyDropReference: 'PENNY-STUB-b2c3d4e5-f6a7-8901-bcde-f12345678901',
          kycStatus: 'PENDING',
          panVerificationStatus: 'PENDING',
          bankVerificationStatus: 'PENDING',
          kycFailureReason: null,
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Host profile not found.' })
  @ApiConflictResponse({ description: 'KYC is already verified.' })
  verifyBank(@GetUser('id') userId: string, @Body() dto: VerifyBankDto) {
    return this.hostsService.verifyBank(userId, dto);
  }

  @Post('kyc/bank-webhook')
  @SkipThrottle()
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  handleBankWebhook(
    @Body() dto: BankWebhookDto,
    @RawBody() rawBody: Buffer,
    @Headers('x-razorpay-signature') signature: string,
  ) {
    return this.hostsService.handleBankWebhook(dto, rawBody, signature);
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
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
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
