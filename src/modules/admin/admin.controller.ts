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

@ApiTags('Admin')
@ApiBearerAuth('firebase-token')
@UseGuards(RolesGuard)
@Roles('SUPER_ADMIN', 'CITY_ADMIN', 'MODERATOR', 'SUPPORT')
@ApiUnauthorizedResponse({ description: 'Missing or invalid Firebase JWT' })
@ApiForbiddenResponse({ description: 'Authenticated user does not have a required admin role' })
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

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
          maskedAadhaar: 'XXXX XXXX 1234',
          kycStatus: 'VERIFIED',
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
