import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommunityRole } from '@prisma/client';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { MinCommunityRole } from '../../common/decorators/min-community-role.decorator';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { CommunityRoleGuard } from '../../common/guards/community-role.guard';
import { CommunityAnnouncementsService } from './community-announcements.service';
import { ListAnnouncementsQueryDto } from './dto/list-announcements-query.dto';

@ApiTags('Community Announcements')
@ApiBearerAuth('firebase-token')
@UseGuards(FirebaseAuthGuard, CommunityRoleGuard)
@MinCommunityRole(CommunityRole.MEMBER)
@Controller('communities/:communityId/announcements')
export class CommunityAnnouncementsController {
  constructor(private readonly service: CommunityAnnouncementsService) {}

  @Get()
  @ApiOperation({ summary: 'List announcements (pinned first, then latest), cursor-paginated' })
  list(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser('dbUserId') userId: string,
    @Query() query: ListAnnouncementsQueryDto,
  ) {
    return this.service.list(communityId, userId, query.cursor, query.limit);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread announcement count for the badge' })
  unreadCount(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser('dbUserId') userId: string,
  ) {
    return this.service.getUnreadCount(communityId, userId);
  }

  @Post('mark-read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark all announcements as read (clears the badge)' })
  markRead(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser('dbUserId') userId: string,
  ) {
    return this.service.markRead(communityId, userId);
  }

  @Get('bookmarks')
  @ApiOperation({ summary: 'List the current user saved announcements in this community' })
  bookmarks(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @GetUser('dbUserId') userId: string,
  ) {
    return this.service.listBookmarks(communityId, userId);
  }

  @Post(':id/like')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Like an announcement' })
  like(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('dbUserId') userId: string,
  ) {
    return this.service.like(communityId, id, userId);
  }

  @Delete(':id/like')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a like' })
  unlike(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('dbUserId') userId: string,
  ) {
    return this.service.unlike(communityId, id, userId);
  }

  @Post(':id/bookmark')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bookmark an announcement' })
  bookmark(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('dbUserId') userId: string,
  ) {
    return this.service.bookmark(communityId, id, userId);
  }

  @Delete(':id/bookmark')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a bookmark' })
  unbookmark(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('dbUserId') userId: string,
  ) {
    return this.service.unbookmark(communityId, id, userId);
  }
}
