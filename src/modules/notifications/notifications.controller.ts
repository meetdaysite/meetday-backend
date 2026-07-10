import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { RolesGuard } from '../../common/guards/roles.guard';

@ApiTags('Notifications')
@ApiBearerAuth('firebase-token')
@ApiUnauthorizedResponse({ description: 'Missing or invalid Firebase JWT' })
@UseGuards(RolesGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List my notifications',
    description: 'Returns a paginated notification feed for the authenticated user. Newest first. Filter by `isRead` for unread-only.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        success: true,
        timestamp: '2026-05-07T10:00:00.000Z',
        data: {
          notifications: [
            { id: 'notif-uuid', type: 'host_approved', title: 'Application Approved', body: 'Your host application has been approved.', isRead: false, readAt: null, createdAt: '2026-05-07T10:00:00.000Z' },
          ],
          total: 1,
          page: 1,
          limit: 20,
          unreadCount: 1,
        },
      },
    },
  })
  findForUser(@GetUser('id') userId: string, @Query() query: ListNotificationsQueryDto) {
    return this.notificationsService.findForUser(userId, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notification count', description: 'Returns the count of unread notifications for the bell icon badge.' })
  @ApiOkResponse({ schema: { example: { success: true, timestamp: '2026-05-07T10:00:00.000Z', data: { count: 3 } } } })
  getUnreadCount(@GetUser('id') userId: string) {
    return this.notificationsService.getUnreadCount(userId);
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark all notifications as read' })
  @ApiOkResponse({ schema: { example: { success: true, timestamp: '2026-05-07T10:00:00.000Z', data: { message: '3 notification(s) marked as read' } } } })
  markAllRead(@GetUser('id') userId: string) {
    return this.notificationsService.markAllRead(userId);
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a single notification as read' })
  @ApiOkResponse({ schema: { example: { success: true, timestamp: '2026-05-07T10:00:00.000Z', data: { message: 'Marked as read' } } } })
  @ApiNotFoundResponse({ description: 'Notification not found.' })
  @ApiForbiddenResponse({ description: 'Notification belongs to a different user.' })
  markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') userId: string,
  ) {
    return this.notificationsService.markRead(id, userId);
  }
}
