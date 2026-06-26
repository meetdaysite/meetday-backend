import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AdminListMembersQueryDto, GenerateInviteDto } from './dto/admin-list-members-query.dto';
import { CommunityMembersAdminService } from './community-members-admin.service';
import {
  BAN_MEMBER_EXAMPLE,
  EXPORT_MEMBERS_EXAMPLE,
  IMPORT_MEMBERS_EXAMPLE,
  INSIGHTS_EXAMPLE,
  INVITE_EXAMPLE,
  KICK_MEMBER_EXAMPLE,
  LIST_MEMBERS_EXAMPLE,
  MEMBER_DETAIL_EXAMPLE,
  MEMBER_STATS_EXAMPLE,
  UNBAN_MEMBER_EXAMPLE,
} from './community-members-admin.swagger';

@ApiTags('Community Members (Admin)')
@ApiBearerAuth('firebase-token')
@UseGuards(RolesGuard)
@Roles('SUPER_ADMIN', 'CITY_ADMIN')
@Controller('admin/communities/:communityId/members')
export class CommunityMembersAdminController {
  constructor(private readonly service: CommunityMembersAdminService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get member stat cards + tab counts (30-day window, 60s cache)' })
  @ApiOkResponse({ description: 'Member stats', content: { 'application/json': { example: MEMBER_STATS_EXAMPLE } } })
  getMemberStats(@Param('communityId') communityId: string) {
    return this.service.getMemberStats(communityId);
  }

  @Get('insights')
  @ApiOperation({ summary: 'Get top cities and member segments sidebar (120s cache)' })
  @ApiOkResponse({ description: 'Member insights', content: { 'application/json': { example: INSIGHTS_EXAMPLE } } })
  getMemberInsightsSidebar(@Param('communityId') communityId: string) {
    return this.service.getMemberInsightsSidebar(communityId);
  }

  @Get('export')
  @ApiOperation({ summary: 'Export all members as CSV (Content-Disposition: attachment)' })
  @ApiOkResponse({ description: 'CSV file', content: { 'text/csv': { example: EXPORT_MEMBERS_EXAMPLE } } })
  async exportMembers(@Param('communityId') communityId: string, @Res() res: Response) {
    const csv = await this.service.exportMembers(communityId);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="members-${communityId}.csv"`);
    res.send(csv);
  }

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Import members from CSV (email column required)' })
  @ApiOkResponse({ description: 'Import result', content: { 'application/json': { example: IMPORT_MEMBERS_EXAMPLE } } })
  importMembers(
    @Param('communityId') communityId: string,
    @GetUser('id') adminId: string,
    @UploadedFile() file: { buffer: Buffer; originalname: string },
  ) {
    return this.service.importMembers(communityId, adminId, file.buffer);
  }

  @Post('invite')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate a shareable invite link for the community' })
  @ApiOkResponse({ description: 'Invite token and URL', content: { 'application/json': { example: INVITE_EXAMPLE } } })
  generateInvite(
    @Param('communityId') communityId: string,
    @GetUser('id') adminId: string,
    @Body() dto: GenerateInviteDto,
  ) {
    return this.service.generateInvite(communityId, adminId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List members with filters, search, and sort' })
  @ApiOkResponse({ description: 'Paginated member list', content: { 'application/json': { example: LIST_MEMBERS_EXAMPLE } } })
  listMembersAdmin(
    @Param('communityId') communityId: string,
    @Query() query: AdminListMembersQueryDto,
  ) {
    return this.service.listMembersAdmin(communityId, query);
  }

  @Get(':userId')
  @ApiOperation({ summary: 'Get detailed member profile including email and ban history' })
  @ApiOkResponse({ description: 'Member detail', content: { 'application/json': { example: MEMBER_DETAIL_EXAMPLE } } })
  getMemberDetail(
    @Param('communityId') communityId: string,
    @Param('userId') userId: string,
  ) {
    return this.service.getMemberDetail(communityId, userId);
  }

  @Post(':userId/ban')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ban a member from the community' })
  @ApiOkResponse({ description: 'Ban applied', content: { 'application/json': { example: BAN_MEMBER_EXAMPLE } } })
  banMember(
    @Param('communityId') communityId: string,
    @Param('userId') userId: string,
    @GetUser('id') adminId: string,
  ) {
    return this.service.banMember(communityId, userId, adminId);
  }

  @Delete(':userId/ban')
  @ApiOperation({ summary: 'Unban a member (restores ACTIVE status and increments memberCount)' })
  @ApiOkResponse({ description: 'Ban removed', content: { 'application/json': { example: UNBAN_MEMBER_EXAMPLE } } })
  unbanMember(
    @Param('communityId') communityId: string,
    @Param('userId') userId: string,
    @GetUser('id') adminId: string,
  ) {
    return this.service.unbanMember(communityId, userId, adminId);
  }

  @Post(':userId/kick')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a member from the community (sets status to LEFT)' })
  @ApiOkResponse({ description: 'Member removed', content: { 'application/json': { example: KICK_MEMBER_EXAMPLE } } })
  kickMember(
    @Param('communityId') communityId: string,
    @Param('userId') userId: string,
    @GetUser('id') adminId: string,
  ) {
    return this.service.kickMember(communityId, userId, adminId);
  }
}
