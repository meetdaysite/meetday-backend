import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
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
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { ReviewsService } from '../reviews/reviews.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { QueryAuditLogDto } from '../audit-log/dto/query-audit-log.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { RejectHostDto } from './dto/reject-host.dto';
import { SuspendHostDto } from './dto/suspend-host.dto';
import { RejectEventDto } from './dto/reject-event.dto';
import { ForceCancelEventDto } from './dto/force-cancel-event.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { ListHostsQueryDto } from './dto/list-hosts-query.dto';
import { ListAdminsQueryDto } from './dto/list-admins-query.dto';
import { ListRolesQueryDto } from './dto/list-roles-query.dto';
import { InviteAdminDto } from './dto/invite-admin.dto';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';
import { ListCouponsQueryDto } from './dto/list-coupons-query.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CreateInterestDto } from './dto/create-interest.dto';
import { UpdateInterestDto } from './dto/update-interest.dto';
import { SetInterestCategoriesDto } from './dto/set-interest-categories.dto';
import { ListEventsQueryDto } from './dto/list-events-query.dto';
import { UpdateGstRateDto } from './dto/update-gst-rate.dto';
import { UpdatePlanFeeRateDto } from './dto/update-plan-fee-rate.dto';
import { CreateHostFeePromoDto } from './dto/create-host-fee-promo.dto';
import { UpdateHostFeePromoDto } from './dto/update-host-fee-promo.dto';
import { UpdateAdminProfileDto } from './dto/update-admin-profile.dto';

@ApiTags('Admin')
@ApiBearerAuth('firebase-token')
@UseGuards(RolesGuard)
@Roles('SUPER_ADMIN', 'CITY_ADMIN', 'MODERATOR', 'SUPPORT')
@ApiUnauthorizedResponse({ description: 'Missing or invalid Firebase JWT' })
@ApiForbiddenResponse({ description: 'Authenticated user does not have a required admin role' })
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly reviewsService: ReviewsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get('admins')
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: 'List all admin users',
    description:
      'Returns a paginated list of all admin users (excludes USER and HOST roles). ' +
      'Filter by role name or active status. Only SUPER_ADMIN can call this endpoint.',
  })
  @ApiOkResponse({
    description: 'Paginated list of admins.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-04-09T10:00:00.000Z',
        data: {
          admins: [
            {
              id: 'user-uuid',
              firstName: 'Rahul',
              lastName: 'Sharma',
              email: 'citymanager@meetday.in',
              isActive: true,
              createdAt: '2026-04-08T10:00:00.000Z',
              role: { name: 'CITY_ADMIN' },
              adminProfile: { managedCities: ['Mumbai', 'Pune'] },
            },
            {
              id: 'user-uuid-2',
              firstName: 'Priya',
              lastName: 'Nair',
              email: 'mod@meetday.in',
              isActive: false,
              createdAt: '2026-04-07T10:00:00.000Z',
              role: { name: 'MODERATOR' },
              adminProfile: null,
            },
          ],
          total: 2,
          page: 1,
          limit: 20,
        },
      },
    },
  })
  listAdmins(@Query() query: ListAdminsQueryDto) {
    return this.adminService.listAdmins(query);
  }

  @Get('roles')
  @ApiOperation({
    summary: 'List roles',
    description:
      'Returns all roles. Pass `adminOnly=true` to exclude end-user roles (`USER`, `HOST`) ' +
      'and get only admin-assignable roles — use this to populate the invite admin role dropdown.',
  })
  @ApiOkResponse({
    description: 'List of roles.',
    schema: {
      examples: {
        all: {
          summary: 'All roles',
          value: {
            success: true,
            timestamp: '2026-04-09T10:00:00.000Z',
            data: [
              { id: 'uuid-1', name: 'CITY_ADMIN', description: null },
              { id: 'uuid-2', name: 'HOST', description: null },
              { id: 'uuid-3', name: 'MODERATOR', description: null },
              { id: 'uuid-4', name: 'SUPER_ADMIN', description: null },
              { id: 'uuid-5', name: 'SUPPORT', description: null },
              { id: 'uuid-6', name: 'USER', description: null },
            ],
          },
        },
        adminOnly: {
          summary: 'Admin roles only (adminOnly=true)',
          value: {
            success: true,
            timestamp: '2026-04-09T10:00:00.000Z',
            data: [
              { id: 'uuid-1', name: 'CITY_ADMIN', description: null },
              { id: 'uuid-3', name: 'MODERATOR', description: null },
              { id: 'uuid-5', name: 'SUPPORT', description: null },
            ],
          },
        },
      },
    },
  })
  getRoles(@Query() query: ListRolesQueryDto) {
    return this.adminService.getRoles(query);
  }

  @Post('invite')
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Invite a new admin user',
    description:
      'Creates a Firebase account and a DB user for the invited admin, then sends an email ' +
      'with a password reset link pointing to the frontend reset-password page. ' +
      'The invited admin **cannot log in** until they click the link and set a password. ' +
      'After setting their password they must call `POST /auth/complete-profile` to fill in ' +
      'their name and activate their account.\n\n' +
      '**Assignable roles:** `CITY_ADMIN`, `MODERATOR`, `SUPPORT` — `SUPER_ADMIN` cannot be granted here.\n\n' +
      'Only `SUPER_ADMIN` can call this endpoint.',
  })
  @ApiBody({
    type: InviteAdminDto,
    examples: {
      inviteCityAdmin: {
        summary: 'Invite a city admin',
        value: { email: 'citymanager@meetday.in', firstName: 'Rahul', lastName: 'Sharma', roleId: 'a3f2c1d4-0000-0000-0000-000000000001', managedCities: ['Mumbai', 'Pune'] },
      },
      inviteModerator: {
        summary: 'Invite a moderator',
        value: { email: 'mod@meetday.in', firstName: 'Priya', lastName: 'Nair', roleId: 'a3f2c1d4-0000-0000-0000-000000000002' },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'Invitation email sent. DB user created with isActive=false, mustCompleteProfile=true.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-04-08T10:00:00.000Z',
        data: { message: 'Invitation sent' },
      },
    },
  })
  @ApiConflictResponse({ description: 'A user with this email already exists in DB or Firebase.' })
  inviteAdmin(@Body() dto: InviteAdminDto) {
    return this.adminService.inviteAdmin(dto);
  }

  @Patch('admins/:id/deactivate')
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Deactivate an admin account',
    description:
      'Sets the target admin\'s `isActive` to `false` in the database and disables their Firebase account, ' +
      'preventing any further logins. Cannot be used to deactivate a `SUPER_ADMIN` or the calling user\'s own account. ' +
      'Only `SUPER_ADMIN` can call this endpoint.',
  })
  @ApiParam({ name: 'id', description: 'User UUID of the admin to deactivate', example: 'user-uuid-1234' })
  @ApiOkResponse({
    description: 'Admin account deactivated.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-04-13T10:00:00.000Z',
        data: { message: 'Admin account deactivated successfully' },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'No admin user found with the given ID.' })
  @ApiBadRequestResponse({ description: 'User is not an admin, is already inactive, or is the calling user.' })
  @ApiForbiddenResponse({ description: 'Target account is a SUPER_ADMIN and cannot be deactivated.' })
  deactivateAdmin(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') requestingAdminId: string,
  ) {
    return this.adminService.deactivateAdmin(id, requestingAdminId);
  }

  @Patch('admins/:id/reactivate')
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reactivate a deactivated admin account',
    description:
      'Sets the target admin\'s `isActive` to `true` in the database and re-enables their Firebase account, ' +
      'restoring login access. Only works on previously deactivated admin accounts. ' +
      'Only `SUPER_ADMIN` can call this endpoint.',
  })
  @ApiParam({ name: 'id', description: 'User UUID of the admin to reactivate', example: 'user-uuid-1234' })
  @ApiOkResponse({
    description: 'Admin account reactivated.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-04-13T10:00:00.000Z',
        data: { message: 'Admin account reactivated successfully' },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'No admin user found with the given ID.' })
  @ApiBadRequestResponse({ description: 'User is not an admin, is already active, or is the calling user.' })
  reactivateAdmin(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') requestingAdminId: string,
  ) {
    return this.adminService.reactivateAdmin(id, requestingAdminId);
  }

  @Get('me')
  @ApiOperation({
    summary: 'Get own admin profile',
    description: 'Returns the profile of the authenticated admin user including their role.',
  })
  @ApiOkResponse({
    description: 'Admin profile.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-04-07T10:00:00.000Z',
        data: {
          id: 'admin-uuid',
          email: 'admin@meetday.in',
          phone: '+919876543210',
          firstName: 'Aishik',
          lastName: 'Sikdar',
          avatarUrl: null,
          isActive: true,
          role: { name: 'SUPER_ADMIN' },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-04-07T10:00:00.000Z',
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Admin user record not found in DB.' })
  getOwnProfile(@GetUser('id') userId: string) {
    return this.adminService.getOwnProfile(userId);
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Update own admin profile',
    description:
      'Updates the authenticated admin\'s own profile picture, phone, and/or name. ' +
      'For the profile picture, first obtain an object key via POST /storage/upload-url ' +
      '(context USER_AVATAR), upload the bytes, then pass the returned key as avatarKey. ' +
      'All fields are optional — send only the ones you want to change.',
  })
  @ApiBody({
    type: UpdateAdminProfileDto,
    examples: {
      fullUpdate: {
        summary: 'Update picture, phone and name',
        value: {
          avatarKey: 'users/6d01f554-2d4a-41c0-8060-368e510ad0bd/avatar/12abd9a8-02b2-4fa4-8e7a-2e7199163a9f.jpg',
          phone: '+919876543210',
          firstName: 'Aishik',
          lastName: 'Sikdar',
        },
      },
      phoneOnly: {
        summary: 'Update only the phone number',
        value: { phone: '+919876543210' },
      },
      avatarOnly: {
        summary: 'Update only the profile picture',
        value: {
          avatarKey: 'users/6d01f554-2d4a-41c0-8060-368e510ad0bd/avatar/12abd9a8-02b2-4fa4-8e7a-2e7199163a9f.jpg',
        },
      },
    },
  })
  @ApiOkResponse({
    description: 'Updated admin profile.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-04-07T10:00:00.000Z',
        data: {
          id: 'admin-uuid',
          email: 'admin@meetday.in',
          phone: '+919876543210',
          firstName: 'Aishik',
          lastName: 'Sikdar',
          avatarUrl: 'https://storage.googleapis.com/.../avatar.jpg?X-Goog-Signature=...',
          isActive: true,
          role: { name: 'SUPER_ADMIN' },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-04-07T10:00:00.000Z',
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Admin user record not found in DB.' })
  @ApiConflictResponse({ description: 'Phone number already in use by another user.' })
  updateOwnProfile(@GetUser('id') userId: string, @Body() dto: UpdateAdminProfileDto) {
    return this.adminService.updateOwnProfile(userId, dto);
  }

  @Get('hosts/pending')
  @Roles('SUPER_ADMIN', 'CITY_ADMIN', 'MODERATOR')
  @ApiOperation({
    summary: 'List hosts pending admin review',
    description:
      'Returns hosts whose KYC is VERIFIED but approval is still PENDING, in FIFO order (oldest first). ' +
      'Supports pagination. Accessible by SUPER_ADMIN, CITY_ADMIN, and MODERATOR.',
  })
  @ApiOkResponse({
    description: 'Paginated list of pending hosts.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-04-07T10:00:00.000Z',
        data: {
          hosts: [
            {
              id: 'hp-uuid',
              hostType: 'INDIVIDUAL',
              displayName: 'Mumbai Walks by Rahul',
              kycStatus: 'VERIFIED',
              approvalStatus: 'PENDING',
              address: { city: 'Mumbai', state: 'Maharashtra', pincode: '400050' },
              user: {
                id: 'user-uuid',
                email: 'host@example.com',
                firstName: 'Rahul',
                lastName: 'Sharma',
                phone: '+919876543210',
              },
              categories: [{ category: { id: 'cat-uuid', name: 'Outdoor Adventures' } }],
              createdAt: '2026-03-01T00:00:00.000Z',
            },
          ],
          total: 1,
          page: 1,
          limit: 20,
        },
      },
    },
  })
  listPendingHosts(@Query() query: ListHostsQueryDto) {
    return this.adminService.listPendingHosts(query);
  }

  @Get('hosts')
  @ApiOperation({
    summary: 'List all hosts with optional filters',
    description:
      'Returns a paginated list of all host profiles. ' +
      'Filter by approvalStatus, kycStatus, plan, or city. ' +
      'Results are ordered newest first.',
  })
  @ApiOkResponse({
    description: 'Paginated list of hosts.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-04-07T10:00:00.000Z',
        data: {
          hosts: [
            {
              id: 'hp-uuid',
              hostType: 'BUSINESS',
              displayName: 'Priya Eats',
              kycStatus: 'VERIFIED',
              approvalStatus: 'APPROVED',
              currentPlan: 'SELL',
              address: { city: 'Bengaluru', state: 'Karnataka', pincode: '560001' },
              user: {
                id: 'user-uuid',
                email: 'host@example.com',
                firstName: 'Priya',
                lastName: 'Nair',
              },
              categories: [{ category: { name: 'Food & Drink' } }],
            },
          ],
          total: 42,
          page: 1,
          limit: 20,
        },
      },
    },
  })
  listAllHosts(@Query() query: ListHostsQueryDto) {
    return this.adminService.listAllHosts(query);
  }

  @Get('hosts/:id')
  @ApiOperation({
    summary: 'Get full host profile detail',
    description:
      'Returns the complete host profile including the linked user record, categories, ' +
      'last 5 subscriptions, and payout account details.',
  })
  @ApiParam({ name: 'id', description: 'Host profile UUID', example: 'hp-uuid-1234' })
  @ApiOkResponse({
    description: 'Full host profile detail.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-04-07T10:00:00.000Z',
        data: {
          id: 'hp-uuid',
          hostType: 'INDIVIDUAL',
          displayName: 'Mumbai Walks by Rahul',
          legalName: 'Rahul Sharma',
          kycStatus: 'VERIFIED',
          panVerificationStatus: 'VERIFIED',
          bankVerificationStatus: 'VERIFIED',
          approvalStatus: 'APPROVED',
          currentPlan: 'COMMUNITY',
          rejectionReason: null,
          approvedAt: '2026-02-15T09:00:00.000Z',
          yearsOfExperience: 3,
          totalEventsPreviouslyHosted: 25,
          operatingCities: ['Mumbai', 'Pune'],
          address: {
            addressLine1: '12, Linking Road',
            addressLine2: 'Bandra West',
            city: 'Mumbai',
            state: 'Maharashtra',
            pincode: '400050',
            country: 'India',
          },
          user: {
            id: 'user-uuid',
            email: 'host@example.com',
            firstName: 'Rahul',
            lastName: 'Sharma',
            phone: '+919876543210',
            isActive: true,
          },
          categories: [{ category: { id: 'cat-uuid', name: 'Social Mixers' } }],
          subscriptions: [
            {
              id: 'sub-uuid',
              plan: 'COMMUNITY',
              status: 'ACTIVE',
              billingCycle: 'YEARLY',
              currentPeriodEnd: '2027-02-15T00:00:00.000Z',
            },
          ],
          payoutAccount: null,
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'No host profile found with the given ID.' })
  getHostDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.getHostDetail(id);
  }

  @Post('hosts/:id/approve')
  @Roles('SUPER_ADMIN', 'CITY_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve a host application',
    description:
      'Approves a host whose KYC is VERIFIED and approvalStatus is PENDING. ' +
      'Sets approvalStatus to APPROVED, records approvedAt and approvedBy, and sets currentPlan to DISCOVER. ' +
      'The HOST role is already assigned at registration or when applying — no role change occurs here. ' +
      'An approval email is dispatched asynchronously. ' +
      'Only SUPER_ADMIN and CITY_ADMIN can approve.',
  })
  @ApiParam({ name: 'id', description: 'Host profile UUID', example: 'hp-uuid-1234' })
  @ApiOkResponse({
    description: 'Host approved.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-04-07T10:00:00.000Z',
        data: { message: 'Host approved successfully' },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Host profile not found.' })
  @ApiBadRequestResponse({ description: 'Host KYC is not yet verified, or host is not in PENDING approval state.' })
  approveHost(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') adminId: string,
  ) {
    return this.adminService.approveHost(id, adminId);
  }

  @Post('hosts/:id/reject')
  @Roles('SUPER_ADMIN', 'CITY_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reject a host application',
    description:
      'Rejects a host whose approvalStatus is PENDING. ' +
      'Sets approvalStatus to REJECTED and stores the rejection reason. ' +
      'A rejection email with the reason is dispatched asynchronously. ' +
      'The host can reapply via POST /hosts/reapply after rejection. ' +
      'Only SUPER_ADMIN and CITY_ADMIN can reject.',
  })
  @ApiParam({ name: 'id', description: 'Host profile UUID', example: 'hp-uuid-1234' })
  @ApiBody({
    type: RejectHostDto,
    examples: {
      default: {
        summary: 'Rejection with reason',
        value: {
          rejectionReason:
            'The host bio does not meet our community guidelines. Please update it and reapply.',
        },
      },
    },
  })
  @ApiOkResponse({
    description: 'Host rejected.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-04-07T10:00:00.000Z',
        data: { message: 'Host rejected successfully' },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Host profile not found.' })
  @ApiBadRequestResponse({ description: 'Host is not in PENDING approval state.' })
  rejectHost(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') adminId: string,
    @Body() dto: RejectHostDto,
  ) {
    return this.adminService.rejectHost(id, adminId, dto);
  }

  @Post('hosts/:id/suspend')
  @Roles('SUPER_ADMIN', 'CITY_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Suspend an approved host',
    description:
      'Immediately suspends an approved host account. ' +
      'The host can no longer submit new events or accept new orders. ' +
      'Existing PUBLISHED events remain visible but new orders will be blocked. ' +
      'A suspension reason is required and is sent to the host via email and in-app notification.',
  })
  @ApiParam({ name: 'id', description: 'Host profile UUID', example: 'hp-uuid-1234' })
  @ApiBody({
    type: SuspendHostDto,
    examples: {
      default: { summary: 'Suspend with reason', value: { reason: 'Multiple reports of fraudulent event listings.' } },
    },
  })
  @ApiOkResponse({
    description: 'Host suspended.',
    schema: { example: { success: true, timestamp: '2026-05-15T10:00:00.000Z', data: { message: 'Host suspended successfully' } } },
  })
  @ApiNotFoundResponse({ description: 'Host profile not found.' })
  @ApiBadRequestResponse({ description: 'Host is not currently approved.' })
  suspendHost(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') adminId: string,
    @Body() dto: SuspendHostDto,
  ) {
    return this.adminService.suspendHost(id, adminId, dto);
  }

  @Post('hosts/:id/restore')
  @Roles('SUPER_ADMIN', 'CITY_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Restore a suspended host',
    description:
      'Restores a suspended host back to APPROVED status. ' +
      'The host can immediately create and submit events again. ' +
      'No body required.',
  })
  @ApiParam({ name: 'id', description: 'Host profile UUID', example: 'hp-uuid-1234' })
  @ApiOkResponse({
    description: 'Host restored.',
    schema: { example: { success: true, timestamp: '2026-05-15T10:00:00.000Z', data: { message: 'Host restored successfully' } } },
  })
  @ApiNotFoundResponse({ description: 'Host profile not found.' })
  @ApiBadRequestResponse({ description: 'Host is not currently suspended.' })
  restoreHost(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') adminId: string,
  ) {
    return this.adminService.restoreHost(id, adminId);
  }

  // ─── Coupon endpoints ────────────────────────────────────────────────────────

  @Post('coupons')
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a coupon',
    description:
      'Creates a new coupon code redeemable by the specified target audience (HOST, ATTENDEE, VENDOR). ' +
      'Supports PERCENTAGE and FLAT discount types applied to the platform fee rate. ' +
      'Only SUPER_ADMIN can create coupons.',
  })
  @ApiBody({
    type: CreateCouponDto,
    examples: {
      foundingHost: {
        summary: 'Founding host — 50% off platform fee',
        value: {
          code: 'FOUNDING50',
          description: '50% off platform fee for founding hosts',
          target: 'HOST',
          discountType: 'PERCENTAGE',
          discountValue: 50,
          maxUsagesPerUser: 1,
        },
      },
      flatDiscount: {
        summary: 'Flat 5-point fee reduction with expiry',
        value: {
          code: 'LAUNCH5',
          description: 'Flat 5% fee reduction for launch period',
          target: 'HOST',
          discountType: 'FLAT',
          discountValue: 5,
          maxUsages: 200,
          validUntil: '2026-12-31T23:59:59.000Z',
        },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'Coupon created.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-04-14T10:00:00.000Z',
        data: {
          id: 'coupon-uuid',
          code: 'FOUNDING50',
          target: 'HOST',
          discountType: 'PERCENTAGE',
          discountValue: 50,
          usageCount: 0,
          isActive: true,
        },
      },
    },
  })
  @ApiConflictResponse({ description: 'A coupon with this code already exists.' })
  @ApiBadRequestResponse({ description: 'validFrom must be before validUntil.' })
  createCoupon(@Body() dto: CreateCouponDto, @GetUser('id') adminId: string) {
    return this.adminService.createCoupon(dto, adminId);
  }

  @Get('coupons')
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: 'List coupons',
    description: 'Returns a paginated list of coupons. Filter by target audience or active status.',
  })
  @ApiOkResponse({
    description: 'Paginated list of coupons.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-04-14T10:00:00.000Z',
        data: {
          coupons: [
            {
              id: 'coupon-uuid',
              code: 'FOUNDING50',
              target: 'HOST',
              discountType: 'PERCENTAGE',
              discountValue: 50,
              usageCount: 12,
              maxUsages: null,
              isActive: true,
              _count: { redemptions: 12 },
            },
          ],
          total: 1,
          page: 1,
          limit: 20,
        },
      },
    },
  })
  listCoupons(@Query() query: ListCouponsQueryDto) {
    return this.adminService.listCoupons(query);
  }

  @Get('coupons/:id')
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: 'Get coupon detail',
    description: 'Returns a single coupon with full redemption history.',
  })
  @ApiParam({ name: 'id', description: 'Coupon UUID', example: 'coupon-uuid-1234' })
  @ApiOkResponse({
    description: 'Coupon detail with redemptions.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-04-14T10:00:00.000Z',
        data: {
          id: 'coupon-uuid',
          code: 'FOUNDING50',
          target: 'HOST',
          discountType: 'PERCENTAGE',
          discountValue: 50,
          usageCount: 1,
          isActive: true,
          redemptions: [
            {
              id: 'redemption-uuid',
              originalFeeRate: 0.15,
              discountedFeeRate: 0.075,
              createdAt: '2026-04-14T10:00:00.000Z',
              user: { id: 'user-uuid', firstName: 'Rahul', lastName: 'Sharma', email: 'host@example.com' },
            },
          ],
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Coupon not found.' })
  getCouponDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.getCouponDetail(id);
  }

  @Patch('coupons/:id/disable')
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Disable a coupon',
    description: 'Sets the coupon isActive to false. Any further redemption attempts will be rejected.',
  })
  @ApiParam({ name: 'id', description: 'Coupon UUID', example: 'coupon-uuid-1234' })
  @ApiOkResponse({
    description: 'Coupon disabled.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-04-14T10:00:00.000Z',
        data: { message: 'Coupon disabled successfully' },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Coupon not found.' })
  @ApiBadRequestResponse({ description: 'Coupon is already inactive.' })
  disableCoupon(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.disableCoupon(id);
  }

  @Patch('coupons/:id/enable')
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enable a coupon', description: 'Sets the coupon isActive to true.' })
  @ApiParam({ name: 'id', description: 'Coupon UUID', example: 'coupon-uuid-1234' })
  @ApiOkResponse({
    description: 'Coupon enabled.',
    schema: { example: { success: true, timestamp: '2026-04-14T10:00:00.000Z', data: { message: 'Coupon enabled successfully' } } },
  })
  @ApiNotFoundResponse({ description: 'Coupon not found.' })
  @ApiBadRequestResponse({ description: 'Coupon is already active.' })
  enableCoupon(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.enableCoupon(id);
  }

  @Patch('coupons/:id')
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update a coupon',
    description:
      'Update mutable coupon fields: description, discount, limits, validity window. ' +
      'code, target, and eventId cannot be changed after creation.',
  })
  @ApiParam({ name: 'id', description: 'Coupon UUID', example: 'coupon-uuid-1234' })
  @ApiBody({
    type: UpdateCouponDto,
    examples: {
      raiseLimit: {
        summary: 'Extend validity and raise the usage cap',
        value: { maxUsages: 500, validUntil: '2027-01-31T23:59:59.000Z' },
      },
      changeDiscount: {
        summary: 'Change the discount value and description',
        value: { discountValue: 40, description: '40% off platform fee — revised offer' },
      },
    },
  })
  @ApiOkResponse({
    description: 'Updated coupon.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-04-14T10:00:00.000Z',
        data: {
          id: 'coupon-uuid',
          code: 'FOUNDING50',
          target: 'HOST',
          discountType: 'PERCENTAGE',
          discountValue: 40,
          maxUsages: 500,
          maxUsagesPerUser: 1,
          usageCount: 12,
          isActive: true,
          validFrom: null,
          validUntil: '2027-01-31T23:59:59.000Z',
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Coupon not found.' })
  @ApiBadRequestResponse({ description: 'validFrom must be before validUntil, or maxUsages below current count.' })
  updateCoupon(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCouponDto) {
    return this.adminService.updateCoupon(id, dto);
  }

  // ─── Category endpoints ──────────────────────────────────────────────────────

  @Post('categories')
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an experience category',
    description:
      'Creates a new experience category that hosts can select when registering or updating their profile. ' +
      'Category names must be unique (case-sensitive). Only SUPER_ADMIN can create categories.',
  })
  @ApiBody({
    type: CreateCategoryDto,
    examples: {
      default: {
        summary: 'Create category',
        value: { name: 'Food & Drink', description: 'Dining experiences, food tours, and culinary workshops' },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'Category created.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-05-07T10:00:00.000Z',
        data: { id: 'cat-uuid', name: 'Food & Drink', description: 'Dining experiences…', isActive: true, createdAt: '2026-05-07T10:00:00.000Z' },
      },
    },
  })
  @ApiConflictResponse({ description: 'A category with this name already exists.' })
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.adminService.createCategory(dto);
  }

  @Patch('categories/:id')
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update an experience category',
    description:
      'Updates the name, description, or active status of a category. ' +
      'Setting `isActive: false` hides the category from hosts and attendees without deleting it. ' +
      'Only SUPER_ADMIN can update categories.',
  })
  @ApiParam({ name: 'id', description: 'Category UUID', example: 'cat-uuid-1234' })
  @ApiBody({
    type: UpdateCategoryDto,
    examples: {
      rename: { summary: 'Rename', value: { name: 'Outdoor Adventures' } },
      deactivate: { summary: 'Deactivate', value: { isActive: false } },
    },
  })
  @ApiOkResponse({
    description: 'Category updated.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-05-07T10:00:00.000Z',
        data: { id: 'cat-uuid', name: 'Outdoor Adventures', description: null, isActive: true, updatedAt: '2026-05-07T10:00:00.000Z' },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Category not found.' })
  @ApiConflictResponse({ description: 'Another category with the new name already exists.' })
  updateCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.adminService.updateCategory(id, dto);
  }

  @Get('categories')
  @ApiOperation({
    summary: 'List all categories (admin view)',
    description:
      'Returns all categories including inactive ones, with isActive status. ' +
      'Use the public GET /categories endpoint for the end-user facing list.',
  })
  @ApiOkResponse({
    description: 'All categories.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-05-07T10:00:00.000Z',
        data: [
          { id: 'cat-uuid-1', name: 'Food & Drink', description: null, isActive: true, createdAt: '2026-05-07T10:00:00.000Z' },
          { id: 'cat-uuid-2', name: 'Deprecated Category', description: null, isActive: false, createdAt: '2026-01-01T10:00:00.000Z' },
        ],
      },
    },
  })
  listCategories() {
    return this.adminService.listCategoriesAdmin();
  }

  // ─── Event review endpoints ───────────────────────────────────────────────────

  @Get('events/pending')
  @Roles('SUPER_ADMIN', 'CITY_ADMIN', 'MODERATOR')
  @ApiOperation({
    summary: 'List events pending admin review',
    description:
      'Returns events in UNDER_REVIEW status, oldest submission first (FIFO). ' +
      'Accessible by SUPER_ADMIN, CITY_ADMIN, and MODERATOR.',
  })
  @ApiOkResponse({
    description: 'Paginated list of events pending review.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-05-11T10:00:00.000Z',
        data: {
          events: [
            {
              id: 'event-uuid',
              title: 'Photography Walk in Bandra',
              eventType: 'Workshop',
              eventDate: '2026-06-15T00:00:00.000Z',
              city: 'Mumbai',
              isFree: false,
              updatedAt: '2026-05-11T09:00:00.000Z',
              category: { id: 'cat-uuid', name: 'Photography' },
              hostProfile: {
                id: 'hp-uuid',
                displayName: 'Mumbai Walks by Rahul',
                user: { id: 'user-uuid', firstName: 'Rahul', lastName: 'Sharma', email: 'host@example.com' },
              },
              _count: { tickets: 2 },
            },
          ],
          total: 1,
          page: 1,
          limit: 20,
        },
      },
    },
  })
  listPendingEvents(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.adminService.listPendingEvents(Number(page), Number(limit));
  }

  @Get('events')
  @Roles('SUPER_ADMIN', 'CITY_ADMIN', 'MODERATOR')
  @ApiOperation({
    summary: 'List all events (admin view)',
    description:
      'Returns a paginated list of all events across all statuses. ' +
      'Filter by status, city, hostProfileId, or categoryId. Ordered newest first.',
  })
  @ApiOkResponse({
    description: 'Paginated list of events.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-05-11T10:00:00.000Z',
        data: {
          events: [
            {
              id: 'event-uuid',
              title: 'Photography Walk in Bandra',
              status: 'PUBLISHED',
              eventType: 'Workshop',
              eventDate: '2026-06-15T00:00:00.000Z',
              city: 'Mumbai',
              isFree: false,
              submittedAt: '2026-05-10T09:00:00.000Z',
              createdAt: '2026-05-09T09:00:00.000Z',
              category: { id: 'cat-uuid', name: 'Photography' },
              hostProfile: {
                id: 'hp-uuid',
                displayName: 'Mumbai Walks by Rahul',
                user: { id: 'user-uuid', firstName: 'Rahul', lastName: 'Sharma', email: 'host@example.com' },
              },
              _count: { tickets: 2 },
            },
          ],
          total: 128,
          page: 1,
          limit: 20,
        },
      },
    },
  })
  listAllEvents(@Query() query: ListEventsQueryDto) {
    return this.adminService.listAllEvents(query);
  }

  @Get('events/:id')
  @Roles('SUPER_ADMIN', 'CITY_ADMIN', 'MODERATOR')
  @ApiOperation({
    summary: 'Get full event detail (admin view)',
    description:
      'Returns all event fields including tickets, refundPolicy, host profile, media, and category. ' +
      'Used when an admin is reviewing an event before approving or rejecting.',
  })
  @ApiParam({ name: 'id', description: 'Event UUID', example: 'event-uuid-1234' })
  @ApiOkResponse({
    description: 'Full event detail. Media URLs are returned as presigned download URLs.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-05-11T10:00:00.000Z',
        data: {
          id: 'event-uuid',
          title: 'Photography Walk in Bandra',
          description: 'A 3-hour guided street photography walk through the lanes of Bandra.',
          status: 'UNDER_REVIEW',
          eventType: 'Workshop',
          eventDate: '2026-06-15T00:00:00.000Z',
          startTime: '2026-06-15T10:00:00.000Z',
          endTime: '2026-06-15T13:00:00.000Z',
          venueName: 'Bandra Bandstand',
          fullAddress: 'Bandstand Promenade, Bandra West, Mumbai',
          city: 'Mumbai',
          isFree: false,
          category: { id: 'cat-uuid', name: 'Photography' },
          hostProfile: {
            id: 'hp-uuid',
            displayName: 'Mumbai Walks by Rahul',
            user: { id: 'user-uuid', firstName: 'Rahul', lastName: 'Sharma', email: 'host@example.com' },
          },
          tickets: [
            { id: 'ticket-uuid', name: 'General Admission', price: 999, quantity: 20, soldCount: 2 },
          ],
          refundPolicy: { id: 'rp-uuid', type: 'FLEXIBLE', cutoffHours: 48 },
          media: [
            { id: 'media-uuid', order: 0, url: 'https://storage.googleapis.com/.../cover.jpg?X-Goog-Signature=...' },
          ],
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Event not found.' })
  getEventDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.getEventDetail(id);
  }

  @Post('events/:id/approve')
  @Roles('SUPER_ADMIN', 'CITY_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve an event',
    description:
      'Approves an event that is in UNDER_REVIEW status, making it PUBLISHED and visible to attendees. ' +
      'Records the reviewing admin and timestamp. Sends an in-app notification to the host. ' +
      'Only SUPER_ADMIN and CITY_ADMIN can approve.',
  })
  @ApiParam({ name: 'id', description: 'Event UUID', example: 'event-uuid-1234' })
  @ApiOkResponse({
    description: 'Event approved and published.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-05-10T10:00:00.000Z',
        data: { message: 'Event approved successfully' },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Event not found.' })
  @ApiBadRequestResponse({ description: 'Event is not in UNDER_REVIEW status.' })
  approveEvent(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') adminId: string,
  ) {
    return this.adminService.approveEvent(id, adminId);
  }

  @Post('events/:id/reject')
  @Roles('SUPER_ADMIN', 'CITY_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reject an event',
    description:
      'Rejects an event that is in UNDER_REVIEW status, moving it back to DRAFT so the host can edit and resubmit. ' +
      'Stores the admin remark on the event record. Sends an in-app notification to the host with the remark. ' +
      'Only SUPER_ADMIN and CITY_ADMIN can reject.',
  })
  @ApiParam({ name: 'id', description: 'Event UUID', example: 'event-uuid-1234' })
  @ApiBody({
    type: RejectEventDto,
    examples: {
      default: {
        summary: 'Rejection with remark',
        value: { remark: 'The event description does not meet our content guidelines. Please revise and resubmit.' },
      },
    },
  })
  @ApiOkResponse({
    description: 'Event rejected and moved back to DRAFT.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-05-10T10:00:00.000Z',
        data: { message: 'Event rejected successfully' },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Event not found.' })
  @ApiBadRequestResponse({ description: 'Event is not in UNDER_REVIEW status.' })
  rejectEvent(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') adminId: string,
    @Body() dto: RejectEventDto,
  ) {
    return this.adminService.rejectEvent(id, adminId, dto);
  }

  @Post('events/:id/force-cancel')
  @Roles('SUPER_ADMIN', 'CITY_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Force-cancel an event (admin override)',
    description:
      'Immediately cancels a PUBLISHED or UNDER_REVIEW event regardless of host action. ' +
      'All PENDING_PAYMENT orders for the event are atomically cancelled and capacity is released. ' +
      'The host is notified via email and in-app notification. ' +
      'Use for policy violations, fraud, or safety concerns.',
  })
  @ApiParam({ name: 'id', description: 'Event UUID', example: 'event-uuid-1234' })
  @ApiBody({
    type: ForceCancelEventDto,
    examples: {
      default: { summary: 'Cancel with reason', value: { reason: 'Event violates platform safety guidelines.' } },
    },
  })
  @ApiOkResponse({
    description: 'Event cancelled. Returns count of pending orders also cancelled.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-05-15T10:00:00.000Z',
        data: { message: 'Event force-cancelled successfully', pendingOrdersCancelled: 3 },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Event not found.' })
  @ApiBadRequestResponse({ description: 'Event is not in PUBLISHED or UNDER_REVIEW status.' })
  forceCancelEvent(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') adminId: string,
    @Body() dto: ForceCancelEventDto,
  ) {
    return this.adminService.forceCancelEvent(id, adminId, dto);
  }

  // ─── Event revisions (edits to published events) ─────────────────────────────

  @Get('events/revisions/pending')
  @Roles('SUPER_ADMIN', 'CITY_ADMIN', 'MODERATOR')
  @ApiOperation({
    summary: 'List pending event revisions',
    description:
      'Paginated queue of edits submitted against already-published events, awaiting review. ' +
      'Venue-changing revisions (`touchesVenue: true`) are surfaced first, then oldest-first (FIFO), ' +
      'so a last-minute venue change is picked up quickly.',
  })
  @ApiOkResponse({ description: 'Paginated list of pending revisions.' })
  listPendingRevisions(
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    return this.adminService.listPendingRevisions(page, limit);
  }

  @Get('events/:id/revision')
  @Roles('SUPER_ADMIN', 'CITY_ADMIN', 'MODERATOR')
  @ApiOperation({
    summary: 'Get the pending revision for an event',
    description:
      'Returns the pending revision alongside the current live values of the changed fields ' +
      '(`current` vs `proposed`), with presigned URLs for both current and proposed media, so an ' +
      'admin can review exactly what will change before approving.',
  })
  @ApiParam({ name: 'id', description: 'Event UUID', example: 'event-uuid-1234' })
  @ApiOkResponse({ description: 'Pending revision with current-vs-proposed diff.' })
  @ApiNotFoundResponse({ description: 'Event not found, or no pending revision.' })
  getRevisionForReview(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.getRevisionForReview(id);
  }

  @Post('events/:id/revision/approve')
  @Roles('SUPER_ADMIN', 'CITY_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve an event revision',
    description:
      "Merges the pending revision into the live event (which stays published). If the revision " +
      'changes the venue, confirmed attendees are notified — a major move (different city or >1km) ' +
      'also triggers an email. Notifies the host that their changes are live.',
  })
  @ApiParam({ name: 'id', description: 'Event UUID', example: 'event-uuid-1234' })
  @ApiOkResponse({
    description: 'Revision approved and applied.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-07-25T10:00:00.000Z',
        data: { message: 'Revision approved and applied' },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Event not found, or no pending revision.' })
  @ApiBadRequestResponse({ description: 'Event is not PUBLISHED.' })
  approveRevision(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') adminId: string,
  ) {
    return this.adminService.approveRevision(id, adminId);
  }

  @Post('events/:id/revision/reject')
  @Roles('SUPER_ADMIN', 'CITY_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reject an event revision',
    description:
      'Discards the pending revision with an admin remark. The live event is left unchanged. ' +
      'Notifies the host with the remark.',
  })
  @ApiParam({ name: 'id', description: 'Event UUID', example: 'event-uuid-1234' })
  @ApiBody({
    type: RejectEventDto,
    examples: {
      default: {
        summary: 'Rejection with remark',
        value: { remark: 'The proposed cover image is low-resolution. Please upload a sharper one.' },
      },
    },
  })
  @ApiOkResponse({
    description: 'Revision rejected.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-07-25T10:00:00.000Z',
        data: { message: 'Revision rejected' },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Event not found, or no pending revision.' })
  rejectRevision(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') adminId: string,
    @Body() dto: RejectEventDto,
  ) {
    return this.adminService.rejectRevision(id, adminId, dto);
  }

  // ─── Order management ────────────────────────────────────────────────────────

  @Get('orders')
  @Roles('SUPER_ADMIN', 'CITY_ADMIN', 'SUPPORT')
  @ApiOperation({
    summary: 'List all orders',
    description:
      'Paginated list of all orders across the platform. ' +
      'Filterable by event, user, host, status, booking ID, and date range. ' +
      'Useful for support investigations and finance reconciliation.',
  })
  @ApiOkResponse({
    description: 'Paginated order list.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-05-15T10:00:00.000Z',
        data: {
          orders: [
            {
              id: 'order-uuid',
              bookingId: 'MDAY-AB12-CD34',
              status: 'CONFIRMED',
              totalAmount: 1180,
              createdAt: '2026-05-10T10:00:00.000Z',
              user: { id: 'user-uuid', firstName: 'Rahul', lastName: 'Sharma', email: 'rahul@example.com' },
              event: { id: 'event-uuid', title: 'Mumbai Heritage Walk', city: 'Mumbai' },
            },
          ],
          total: 1,
          page: 1,
          limit: 20,
        },
      },
    },
  })
  listOrders(@Query() query: ListOrdersQueryDto) {
    return this.adminService.listOrders(query);
  }

  @Get('orders/:id')
  @Roles('SUPER_ADMIN', 'CITY_ADMIN', 'SUPPORT')
  @ApiOperation({
    summary: 'Get order detail',
    description: 'Full order detail including attendees, ticket codes, coupon, and financials. No ownership restriction.',
  })
  @ApiParam({ name: 'id', description: 'Order UUID', example: 'order-uuid-1234' })
  @ApiOkResponse({
    description: 'Full order detail including buyer, event, coupon, line items, and per-ticket attendees.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-05-15T10:00:00.000Z',
        data: {
          id: 'order-uuid',
          bookingId: 'MDAY-AB12-CD34',
          status: 'CONFIRMED',
          subtotal: 1998,
          discountAmount: 200,
          platformFee: 270,
          taxAmount: 320,
          totalAmount: 2388,
          confirmedAt: '2026-05-10T10:05:00.000Z',
          cancelledAt: null,
          createdAt: '2026-05-10T10:00:00.000Z',
          user: { id: 'user-uuid', firstName: 'Rahul', lastName: 'Sharma', email: 'rahul@example.com', phone: '+919876543210' },
          event: {
            id: 'event-uuid',
            title: 'Mumbai Heritage Walk',
            eventDate: '2026-06-15T00:00:00.000Z',
            startTime: '2026-06-15T10:00:00.000Z',
            endTime: '2026-06-15T13:00:00.000Z',
            venueName: 'Gateway of India',
            fullAddress: 'Apollo Bandar, Colaba, Mumbai',
            city: 'Mumbai',
            hostProfile: { id: 'hp-uuid', displayName: 'Mumbai Walks by Rahul', userId: 'host-user-uuid' },
          },
          coupon: { code: 'LAUNCH200', discountType: 'FLAT', discountValue: 200 },
          items: [
            {
              id: 'order-item-uuid',
              quantity: 2,
              unitPrice: 999,
              ticket: { id: 'ticket-uuid', name: 'General Admission', description: 'Standard entry', price: 999 },
              attendees: [
                { id: 'attendee-uuid-1', name: 'Rahul Sharma', ticketCode: 'MDAY-TCKT-0001', cancelledAt: null },
                { id: 'attendee-uuid-2', name: 'Priya Nair', ticketCode: 'MDAY-TCKT-0002', cancelledAt: null },
              ],
            },
          ],
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Order not found.' })
  getOrderDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.getOrderDetail(id);
  }

  // ─── Interests ───────────────────────────────────────────────────────────────

  @Post('interests')
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an interest',
    description:
      'Creates a new interest that users can pick during onboarding. ' +
      'The slug is auto-generated from the name (e.g. "Founder\'s Huddle" → "founders-huddle"). ' +
      'For the cover image, pass an S3 object key; the response returns it as a presigned download URL. ' +
      'Only SUPER_ADMIN can call this endpoint.',
  })
  @ApiBody({
    type: CreateInterestDto,
    examples: {
      default: {
        summary: 'Create interest with cover image',
        value: {
          name: "Founder's Huddle",
          description: 'For startup founders and entrepreneurs building the next big thing',
          image: 'interests/founders-huddle.jpg',
        },
      },
      minimal: {
        summary: 'Name only',
        value: { name: 'Live Music' },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'Interest created. `image` is returned as a presigned URL (or null).',
    schema: {
      example: {
        success: true,
        timestamp: '2026-07-03T10:00:00.000Z',
        data: {
          id: 'interest-uuid',
          name: "Founder's Huddle",
          slug: 'founders-huddle',
          description: 'For startup founders and entrepreneurs building the next big thing',
          image: 'https://storage.googleapis.com/.../founders-huddle.jpg?X-Goog-Signature=...',
          createdAt: '2026-07-03T10:00:00.000Z',
        },
      },
    },
  })
  @ApiConflictResponse({ description: 'An interest with this name already exists.' })
  createInterest(@Body() dto: CreateInterestDto) {
    return this.adminService.createInterest(dto);
  }

  @Get('interests')
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: 'List all interests',
    description:
      'Returns all interests ordered by name, each with its mapped categories. ' +
      'Image keys are returned as presigned download URLs. Only SUPER_ADMIN.',
  })
  @ApiOkResponse({
    description: 'List of interests with their category mappings.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-07-03T10:00:00.000Z',
        data: [
          {
            id: 'interest-uuid',
            name: "Founder's Huddle",
            slug: 'founders-huddle',
            description: 'For startup founders and entrepreneurs',
            image: 'https://storage.googleapis.com/.../founders-huddle.jpg?X-Goog-Signature=...',
            categoryMappings: [
              { interestId: 'interest-uuid', categoryId: 'cat-uuid', category: { id: 'cat-uuid', name: 'Networking' } },
            ],
          },
        ],
      },
    },
  })
  getInterests() {
    return this.adminService.getInterests();
  }

  @Get('interests/:id')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Get interest by ID', description: 'Returns a single interest with its category mappings. Only SUPER_ADMIN.' })
  @ApiParam({ name: 'id', description: 'Interest UUID', example: 'interest-uuid-1234' })
  @ApiOkResponse({
    description: 'Interest detail with category mappings.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-07-03T10:00:00.000Z',
        data: {
          id: 'interest-uuid',
          name: "Founder's Huddle",
          slug: 'founders-huddle',
          description: 'For startup founders and entrepreneurs',
          image: 'https://storage.googleapis.com/.../founders-huddle.jpg?X-Goog-Signature=...',
          categoryMappings: [
            { interestId: 'interest-uuid', categoryId: 'cat-uuid', category: { id: 'cat-uuid', name: 'Networking' } },
          ],
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Interest not found.' })
  getInterestById(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.getInterestById(id);
  }

  @Patch('interests/:id')
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: 'Update an interest',
    description:
      'Partially updates an interest — send only the fields you want to change. ' +
      'The slug is re-generated if the name changes. Only SUPER_ADMIN.',
  })
  @ApiParam({ name: 'id', description: 'Interest UUID', example: 'interest-uuid-1234' })
  @ApiBody({
    type: UpdateInterestDto,
    examples: {
      rename: { summary: 'Rename (slug regenerates)', value: { name: 'Startup Founders' } },
      changeImage: { summary: 'Replace the cover image', value: { image: 'interests/startup-founders.jpg' } },
    },
  })
  @ApiOkResponse({
    description: 'Updated interest.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-07-03T10:00:00.000Z',
        data: {
          id: 'interest-uuid',
          name: 'Startup Founders',
          slug: 'startup-founders',
          description: 'For startup founders and entrepreneurs',
          image: 'https://storage.googleapis.com/.../startup-founders.jpg?X-Goog-Signature=...',
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Interest not found.' })
  @ApiConflictResponse({ description: 'An interest with this name already exists.' })
  updateInterest(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInterestDto,
  ) {
    return this.adminService.updateInterest(id, dto);
  }

  @Put('interests/:id/categories')
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: 'Replace category mappings for an interest',
    description:
      'Full replace — existing mappings are deleted and replaced with the provided list. ' +
      'Pass an empty array to clear all mappings. Duplicate categoryIds in the request are ignored. Only SUPER_ADMIN.',
  })
  @ApiParam({ name: 'id', description: 'Interest UUID', example: 'interest-uuid-1234' })
  @ApiBody({
    type: SetInterestCategoriesDto,
    examples: {
      setTwo: { summary: 'Map to two categories', value: { categoryIds: ['cat-uuid-1', 'cat-uuid-2'] } },
      clearAll: { summary: 'Clear all mappings', value: { categoryIds: [] } },
    },
  })
  @ApiOkResponse({
    description: 'Interest with its updated category mappings.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-07-03T10:00:00.000Z',
        data: {
          id: 'interest-uuid',
          name: "Founder's Huddle",
          slug: 'founders-huddle',
          image: null,
          categoryMappings: [
            { interestId: 'interest-uuid', categoryId: 'cat-uuid-1', category: { id: 'cat-uuid-1', name: 'Networking' } },
            { interestId: 'interest-uuid', categoryId: 'cat-uuid-2', category: { id: 'cat-uuid-2', name: 'Business' } },
          ],
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Interest not found.' })
  setInterestCategories(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetInterestCategoriesDto,
  ) {
    return this.adminService.setInterestCategories(id, dto.categoryIds);
  }

  // ─── Audit Logs ───────────────────────────────────────────────────────────

  @Get('audit-logs')
  @Roles('SUPER_ADMIN', 'CITY_ADMIN')
  @ApiOperation({
    summary: 'Query audit logs',
    description:
      'Returns a paginated, filtered list of audit log entries. ' +
      'Filter by actor, entity type/ID, action, or date range. ' +
      'Only SUPER_ADMIN and CITY_ADMIN can access audit logs.',
  })
  @ApiOkResponse({
    description: 'Paginated audit log entries, newest first.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-07-03T10:00:00.000Z',
        data: {
          data: [
            {
              id: 'audit-uuid',
              actorId: 'admin-uuid',
              actorRole: 'ADMIN',
              action: 'KYC_APPROVED',
              entityType: 'HOST',
              entityId: 'hp-uuid',
              metadata: null,
              createdAt: '2026-07-03T09:59:00.000Z',
              actor: { id: 'admin-uuid', firstName: 'Aishik', lastName: 'Sikdar', email: 'admin@meetday.in' },
            },
            {
              id: 'audit-uuid-2',
              actorId: 'admin-uuid',
              actorRole: 'ADMIN',
              action: 'EVENT_REJECTED',
              entityType: 'EVENT',
              entityId: 'event-uuid',
              metadata: { eventTitle: 'Photography Walk', remark: 'Please revise the description.' },
              createdAt: '2026-07-03T09:40:00.000Z',
              actor: { id: 'admin-uuid', firstName: 'Aishik', lastName: 'Sikdar', email: 'admin@meetday.in' },
            },
          ],
          total: 2,
          page: 1,
          limit: 50,
        },
      },
    },
  })
  queryAuditLogs(@Query() query: QueryAuditLogDto) {
    return this.auditLogService.queryLogs(query);
  }

  // ─── Reviews ──────────────────────────────────────────────────────────────

  @Get('reviews')
  @ApiOperation({
    summary: 'List all reviews with moderation status',
    description:
      'Returns a paginated list of every event review across the platform, newest first, ' +
      'each with its author, the reviewed event, and any attached photos with their approval status. ' +
      'Use the visibility endpoint to hide a review that violates guidelines.',
  })
  @ApiOkResponse({
    description: 'Paginated list of reviews.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-07-03T10:00:00.000Z',
        data: {
          reviews: [
            {
              id: 'review-uuid',
              rating: 5,
              comment: 'Fantastic walk, our host knew every hidden corner of Bandra!',
              isVisible: true,
              createdAt: '2026-06-16T08:00:00.000Z',
              event: { id: 'event-uuid', title: 'Mumbai Heritage Walk' },
              user: { id: 'user-uuid', firstName: 'Rahul', lastName: 'Sharma', email: 'rahul@example.com' },
              photos: [{ id: 'photo-uuid', approvalStatus: 'APPROVED' }],
            },
          ],
          total: 1,
          page: 1,
          limit: 20,
        },
      },
    },
  })
  listReviews(
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.reviewsService.listAllReviews(page, limit);
  }

  @Patch('reviews/:id/visibility')
  @ApiOperation({
    summary: 'Show or hide a review',
    description:
      'Toggles whether a review is publicly visible. Hiding a review excludes it from the host ' +
      'rating aggregate, which is recalculated automatically.',
  })
  @ApiParam({ name: 'id', description: 'Review UUID', example: 'review-uuid-1234' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['isVisible'],
      properties: { isVisible: { type: 'boolean', example: false, description: 'true to show, false to hide' } },
    },
    examples: {
      hide: { summary: 'Hide the review', value: { isVisible: false } },
      show: { summary: 'Show the review', value: { isVisible: true } },
    },
  })
  @ApiOkResponse({
    description: 'Updated review.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-07-03T10:00:00.000Z',
        data: {
          id: 'review-uuid',
          rating: 5,
          comment: 'Fantastic walk, our host knew every hidden corner of Bandra!',
          isVisible: false,
          eventId: 'event-uuid',
          userId: 'user-uuid',
          createdAt: '2026-06-16T08:00:00.000Z',
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Review not found.' })
  setReviewVisibility(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('isVisible') isVisible: boolean,
  ) {
    return this.reviewsService.setReviewVisibility(id, isVisible);
  }

  // ─── Platform Config ───────────────────────────────────────────────────────

  @Get('platform-config')
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: 'Get all platform config values',
    description: 'Returns every platform config entry as a key-value map. Values are stored as strings. Only SUPER_ADMIN.',
  })
  @ApiOkResponse({
    description: 'Key-value map of all platform config entries.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-07-03T10:00:00.000Z',
        data: { gst_rate: '0.18' },
      },
    },
  })
  getPlatformConfig() {
    return this.adminService.getPlatformConfig();
  }

  @Patch('platform-config/gst-rate')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Update platform GST rate', description: 'Updates the GST rate applied to all new orders. Value is a decimal (e.g. 0.18 = 18%). Only SUPER_ADMIN.' })
  @ApiBody({
    type: UpdateGstRateDto,
    examples: { default: { summary: 'Set GST to 18%', value: { gstRate: 0.18 } } },
  })
  @ApiOkResponse({
    description: 'Updated GST rate.',
    schema: {
      example: { success: true, timestamp: '2026-07-03T10:00:00.000Z', data: { gstRate: 0.18 } },
    },
  })
  updateGstRate(@Body() dto: UpdateGstRateDto) {
    return this.adminService.updateGstRate(dto);
  }

  @Patch('subscription-plans/:plan/fee-rate')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Update platform fee rate for a subscription plan', description: 'Updates the platformFeeRate on a subscription plan (DISCOVER, SELL, COMMUNITY). Value is a decimal (e.g. 0.15 = 15%). Only SUPER_ADMIN.' })
  @ApiParam({ name: 'plan', enum: ['DISCOVER', 'SELL', 'COMMUNITY'], example: 'SELL' })
  @ApiBody({
    type: UpdatePlanFeeRateDto,
    examples: { default: { summary: 'Set fee to 15%', value: { feeRate: 0.15 } } },
  })
  @ApiOkResponse({
    description: 'Updated plan fee rate.',
    schema: {
      example: { success: true, timestamp: '2026-07-03T10:00:00.000Z', data: { plan: 'SELL', platformFeeRate: 0.15 } },
    },
  })
  @ApiNotFoundResponse({ description: 'Plan not found.' })
  updateSubscriptionPlanFeeRate(@Param('plan') plan: string, @Body() dto: UpdatePlanFeeRateDto) {
    return this.adminService.updateSubscriptionPlanFeeRate(plan, dto);
  }

  // ─── Host Fee Promos ───────────────────────────────────────────────────────

  @Post('hosts/:hostProfileId/fee-promos')
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: 'Create a platform fee promo for a host',
    description:
      'Grants a host a discount on their platform fee, bounded by a date window and/or a max number of events. ' +
      'Leave validFrom/validUntil null for an open-ended promo, and maxEvents null for unlimited events. Only SUPER_ADMIN.',
  })
  @ApiParam({ name: 'hostProfileId', description: 'Host profile UUID', example: 'hp-uuid-1234' })
  @ApiBody({
    type: CreateHostFeePromoDto,
    examples: {
      timeBound: {
        summary: '50% off for a 2-month window',
        value: {
          discountType: 'PERCENTAGE',
          discountValue: 50,
          validFrom: '2026-07-01T00:00:00.000Z',
          validUntil: '2026-09-01T00:00:00.000Z',
        },
      },
      eventCapped: {
        summary: 'Flat 5-point reduction for the next 5 events',
        value: { discountType: 'FLAT', discountValue: 5, maxEvents: 5 },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'Fee promo created.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-07-03T10:00:00.000Z',
        data: {
          id: 'promo-uuid',
          hostProfileId: 'hp-uuid',
          discountType: 'PERCENTAGE',
          discountValue: 50,
          validFrom: '2026-07-01T00:00:00.000Z',
          validUntil: '2026-09-01T00:00:00.000Z',
          maxEvents: null,
          isActive: true,
          createdAt: '2026-07-03T10:00:00.000Z',
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Host profile not found.' })
  createHostFeePromo(@Param('hostProfileId', ParseUUIDPipe) hostProfileId: string, @Body() dto: CreateHostFeePromoDto) {
    return this.adminService.createHostFeePromo(hostProfileId, dto);
  }

  @Get('hosts/:hostProfileId/fee-promos')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'List fee promos for a host', description: 'Returns all fee promos for the host, newest first. Only SUPER_ADMIN.' })
  @ApiParam({ name: 'hostProfileId', description: 'Host profile UUID', example: 'hp-uuid-1234' })
  @ApiOkResponse({
    description: 'Array of fee promos.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-07-03T10:00:00.000Z',
        data: [
          {
            id: 'promo-uuid',
            hostProfileId: 'hp-uuid',
            discountType: 'PERCENTAGE',
            discountValue: 50,
            validFrom: '2026-07-01T00:00:00.000Z',
            validUntil: '2026-09-01T00:00:00.000Z',
            maxEvents: null,
            isActive: true,
            createdAt: '2026-07-03T10:00:00.000Z',
          },
        ],
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Host profile not found.' })
  getHostFeePromos(@Param('hostProfileId', ParseUUIDPipe) hostProfileId: string) {
    return this.adminService.getHostFeePromos(hostProfileId);
  }

  @Patch('hosts/:hostProfileId/fee-promos/:promoId')
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: 'Deactivate or update a host fee promo',
    description: 'Update a promo\'s active flag and/or expiry date. Send only the fields you want to change. Only SUPER_ADMIN.',
  })
  @ApiParam({ name: 'hostProfileId', description: 'Host profile UUID', example: 'hp-uuid-1234' })
  @ApiParam({ name: 'promoId', description: 'Fee promo UUID', example: 'promo-uuid-1234' })
  @ApiBody({
    type: UpdateHostFeePromoDto,
    examples: {
      deactivate: { summary: 'Deactivate the promo', value: { isActive: false } },
      extend: { summary: 'Extend the expiry date', value: { validUntil: '2026-12-31T23:59:59.000Z' } },
    },
  })
  @ApiOkResponse({
    description: 'Updated fee promo.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-07-03T10:00:00.000Z',
        data: {
          id: 'promo-uuid',
          hostProfileId: 'hp-uuid',
          discountType: 'PERCENTAGE',
          discountValue: 50,
          validFrom: '2026-07-01T00:00:00.000Z',
          validUntil: '2026-12-31T23:59:59.000Z',
          maxEvents: null,
          isActive: false,
          createdAt: '2026-07-03T10:00:00.000Z',
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Promo not found.' })
  updateHostFeePromo(
    @Param('hostProfileId', ParseUUIDPipe) hostProfileId: string,
    @Param('promoId', ParseUUIDPipe) promoId: string,
    @Body() dto: UpdateHostFeePromoDto,
  ) {
    return this.adminService.updateHostFeePromo(hostProfileId, promoId, dto);
  }
}
