import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiConflictResponse, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { BrandsService } from './brands.service';
import { UpdateBrandProfileDto } from './dto/update-brand-profile.dto';
import { InviteTeamMemberDto } from '../../common/team-access/dto/invite-team-member.dto';
import { SetMemberPermissionDto } from '../../common/team-access/dto/set-member-permission.dto';

@ApiTags('Brands')
@ApiBearerAuth('firebase-token')
@UseGuards(RolesGuard)
@Roles('BRAND')
@Controller('brands')
export class BrandsController {
  constructor(private readonly brandsService: BrandsService) {}

  @Get('me')
  @ApiOperation({ summary: "Get the authenticated brand's own profile" })
  @ApiOkResponse({ description: 'Brand profile, including `isProfileComplete`.' })
  getMe(@GetUser('id') userId: string) {
    return this.brandsService.getMe(userId);
  }

  @Patch('me')
  @ApiOperation({
    summary: "Update the authenticated brand's profile",
    description:
      'All fields optional/skippable. Categories and social links must all be filled in for ' +
      '`isProfileComplete` to become true, which is required to mark interest in a proposal.',
  })
  @ApiOkResponse({ description: 'Updated brand profile.' })
  updateMe(@GetUser('id') userId: string, @Body() dto: UpdateBrandProfileDto) {
    return this.brandsService.updateProfile(userId, dto);
  }

  @Get('members')
  @ApiOperation({ summary: "List the brand's team members (owner + invited members), name + email visible to everyone" })
  @ApiOkResponse({ description: 'Array of members, owner first.' })
  listTeamMembers(@GetUser('id') userId: string) {
    return this.brandsService.listTeamMembers(userId);
  }

  @Post('members')
  @ApiOperation({
    summary: 'Invite a new team member by email',
    description: 'Any existing member (owner or active member) can invite someone by email. The invite is auto-matched on signup and grants full dashboard access.',
  })
  @ApiOkResponse({ description: 'The created/updated (pending) team member invite.' })
  @ApiConflictResponse({ description: "This email is already a member, or is the owner's own email." })
  inviteTeamMember(@GetUser('id') userId: string, @Body() dto: InviteTeamMemberDto) {
    return this.brandsService.inviteTeamMember(userId, dto.email);
  }

  @Delete('members/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a team member (or cancel a pending invite)',
    description:
      "Deletes the invite/membership row entirely \u2014 the invite email already sent can't be " +
      'unsent, but the removed email can no longer be used to join this brand afterward.',
  })
  removeTeamMember(@GetUser('id') userId: string, @Param('id') memberId: string) {
    return this.brandsService.removeTeamMember(userId, memberId);
  }

  @Patch('members/:id/permission')
  @ApiOperation({
    summary: "Owner-only: grant/revoke a member's permission to add/remove other members",
    description: 'WhatsApp-group-admin style — everyone can add members by default, the owner can restrict specific members.',
  })
  @ApiForbiddenResponse({ description: 'Only the owner can change member permissions.' })
  setMemberPermission(@GetUser('id') userId: string, @Param('id') memberId: string, @Body() dto: SetMemberPermissionDto) {
    return this.brandsService.setMemberPermission(userId, memberId, dto.canManageMembers);
  }
}
