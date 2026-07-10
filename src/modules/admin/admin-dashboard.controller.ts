import { Controller, Get, ParseIntPipe, Query, UseGuards, DefaultValuePipe } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AdminDashboardService } from './admin-dashboard.service';
import { DashboardRevenueQueryDto } from './dto/dashboard-revenue-query.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('Admin Dashboard')
@ApiBearerAuth('firebase-token')
@UseGuards(RolesGuard)
@ApiUnauthorizedResponse({ description: 'Missing or invalid Firebase JWT' })
@ApiForbiddenResponse({ description: 'Authenticated user does not have a required admin role' })
@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly dashboardService: AdminDashboardService) {}

  @Get('stats')
  @Roles('SUPER_ADMIN', 'CITY_ADMIN')
  @ApiOperation({
    summary: 'Top-level stat cards',
    description: 'Returns pending review count, live events, support flags, and today\'s revenue. Cached 30s.',
  })
  @ApiOkResponse({
    description: 'Dashboard stat cards.',
    schema: {
      example: {
        pendingReviews: 104,
        liveEvents: 24,
        liveEventsStartingToday: 6,
        supportFlags: 8,
        revenueToday: 24876000,
        revenueTodayDelta: 18.6,
      },
    },
  })
  getStats() {
    return this.dashboardService.getStats();
  }

  @Get('review-queue')
  @Roles('SUPER_ADMIN', 'CITY_ADMIN', 'MODERATOR')
  @ApiOperation({
    summary: 'Review queue counts',
    description: 'Returns per-category counts for the review queue section. Cached 30s.',
  })
  @ApiOkResponse({
    description: 'Review queue breakdown.',
    schema: {
      example: {
        hostApprovals: 18,
        eventApprovals: 27,
        contributorRequests: 23,
        reportedContent: 16,
      },
    },
  })
  getReviewQueue() {
    return this.dashboardService.getReviewQueue();
  }

  @Get('live-operations')
  @Roles('SUPER_ADMIN', 'CITY_ADMIN', 'MODERATOR')
  @ApiOperation({
    summary: 'Live operations metrics',
    description: 'Returns currently live event count, today\'s check-ins, and capacity alerts. Cached 30s.',
  })
  @ApiOkResponse({
    description: 'Live operations data.',
    schema: {
      example: {
        eventsLiveNow: 24,
        checkInsToday: 1842,
        capacityAlerts: 7,
      },
    },
  })
  getLiveOperations() {
    return this.dashboardService.getLiveOperations();
  }

  @Get('revenue')
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: 'Revenue overview with time series',
    description: 'Returns revenue totals, breakdown, and daily time series for the selected period. Cached 5 min.',
  })
  @ApiOkResponse({
    description: 'Revenue overview.',
    schema: {
      example: {
        total: 2478560,
        totalDelta: 16.4,
        ticketRevenue: 1845230,
        platformFees: 312450,
        sponsorships: 0,
        others: 0,
        timeSeries: [{ date: '2025-04-24', ticketRevenue: 45000, platformFee: 9000 }],
      },
    },
  })
  getRevenue(@Query() query: DashboardRevenueQueryDto) {
    return this.dashboardService.getRevenue(query);
  }

  @Get('recent-activity')
  @Roles('SUPER_ADMIN', 'CITY_ADMIN', 'MODERATOR', 'SUPPORT')
  @ApiOperation({
    summary: 'Recent platform activity feed',
    description: 'Returns the most recent admin-relevant audit log events with human-readable labels. Cached 15s.',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Max items to return (default 20, max 50)' })
  @ApiOkResponse({
    description: 'Recent activity items.',
    schema: {
      example: {
        items: [
          {
            id: 'uuid',
            action: 'HOST_APPLIED',
            label: 'New host application by Rahul Sharma',
            subLabel: 'Mumbai',
            actorName: 'Rahul Sharma',
            timestamp: '2025-05-24T10:05:00Z',
          },
        ],
      },
    },
  })
  getRecentActivity(@Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number) {
    return this.dashboardService.getRecentActivity(Math.min(limit, 50));
  }

  @Get('health')
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: 'Platform health check',
    description: 'Returns operational status for Server, Payment Gateway, Notifications, and Check-in System. Cached 10s.',
  })
  @ApiOkResponse({
    description: 'Platform health.',
    schema: {
      example: {
        server: 'operational',
        paymentGateway: 'operational',
        notifications: 'operational',
        checkInSystem: 'operational',
      },
    },
  })
  getHealth() {
    return this.dashboardService.getHealth();
  }
}
