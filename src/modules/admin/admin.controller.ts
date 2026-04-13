import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
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
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { RejectHostDto } from './dto/reject-host.dto';
import { ListHostsQueryDto } from './dto/list-hosts-query.dto';
import { ListAdminsQueryDto } from './dto/list-admins-query.dto';
import { ListRolesQueryDto } from './dto/list-roles-query.dto';
import { InviteAdminDto } from './dto/invite-admin.dto';

@ApiTags('Admin')
@ApiBearerAuth('firebase-token')
@UseGuards(RolesGuard)
@Roles('SUPER_ADMIN', 'CITY_ADMIN', 'MODERATOR', 'SUPPORT')
@ApiUnauthorizedResponse({ description: 'Missing or invalid Firebase JWT' })
@ApiForbiddenResponse({ description: 'Authenticated user does not have a required admin role' })
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

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
}
