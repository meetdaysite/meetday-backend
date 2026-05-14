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
import { RejectEventDto } from './dto/reject-event.dto';
import { ListHostsQueryDto } from './dto/list-hosts-query.dto';
import { ListAdminsQueryDto } from './dto/list-admins-query.dto';
import { ListRolesQueryDto } from './dto/list-roles-query.dto';
import { InviteAdminDto } from './dto/invite-admin.dto';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { ListCouponsQueryDto } from './dto/list-coupons-query.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CreateInterestDto } from './dto/create-interest.dto';
import { UpdateInterestDto } from './dto/update-interest.dto';
import { SetInterestCategoriesDto } from './dto/set-interest-categories.dto';
import { ListEventsQueryDto } from './dto/list-events-query.dto';

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
  @ApiOkResponse({ description: 'Paginated list of events.' })
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
  @ApiOkResponse({ description: 'Full event detail.' })
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

  // ─── Interests ───────────────────────────────────────────────────────────────

  @Post('interests')
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an interest',
    description: 'Creates a new interest. Slug is auto-generated from the name. Only SUPER_ADMIN.',
  })
  @ApiBody({ type: CreateInterestDto })
  @ApiCreatedResponse({ description: 'Interest created.' })
  @ApiConflictResponse({ description: 'An interest with this name already exists.' })
  createInterest(@Body() dto: CreateInterestDto) {
    return this.adminService.createInterest(dto);
  }

  @Get('interests')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'List all interests', description: 'Returns all interests ordered by name. Only SUPER_ADMIN.' })
  @ApiOkResponse({ description: 'List of interests.' })
  getInterests() {
    return this.adminService.getInterests();
  }

  @Get('interests/:id')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Get interest by ID', description: 'Returns a single interest by UUID. Only SUPER_ADMIN.' })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ description: 'Interest detail.' })
  @ApiNotFoundResponse({ description: 'Interest not found.' })
  getInterestById(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.getInterestById(id);
  }

  @Patch('interests/:id')
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: 'Update an interest',
    description: 'Partially updates an interest. Slug is re-generated if name changes. Only SUPER_ADMIN.',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiBody({ type: UpdateInterestDto })
  @ApiOkResponse({ description: 'Interest updated.' })
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
    description: 'Full replace — existing mappings are deleted and replaced with the provided list. Pass an empty array to clear all mappings. Duplicate categoryIds in the request are ignored.',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiBody({ type: SetInterestCategoriesDto })
  @ApiOkResponse({ description: 'Interest with updated category mappings.' })
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
  @ApiOkResponse({ description: 'Paginated audit log entries.' })
  queryAuditLogs(@Query() query: QueryAuditLogDto) {
    return this.auditLogService.queryLogs(query);
  }

  // ─── Reviews ──────────────────────────────────────────────────────────────

  @Get('reviews')
  @ApiOperation({ summary: 'List all reviews with moderation status' })
  listReviews(
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.reviewsService.listAllReviews(page, limit);
  }

  @Patch('reviews/:id/visibility')
  @ApiOperation({ summary: 'Show or hide a review' })
  @ApiParam({ name: 'id', type: String })
  setReviewVisibility(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('isVisible') isVisible: boolean,
  ) {
    return this.reviewsService.setReviewVisibility(id, isVisible);
  }
}
