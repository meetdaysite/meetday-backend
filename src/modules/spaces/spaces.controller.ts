import { Body, Controller, Delete, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { SpacesService } from './spaces.service';
import { UpdateSpaceProfileDto } from './dto/update-space-profile.dto';
import { ActivateSpaceCommunityDto } from './dto/activate-space-community.dto';

@ApiTags('Spaces')
@ApiBearerAuth('firebase-token')
@UseGuards(RolesGuard)
@Roles('SPACE_PARTNER')
@Controller('spaces')
export class SpacesController {
  constructor(private readonly spacesService: SpacesService) {}

  @Get('me')
  @ApiOperation({ summary: "Get the authenticated space partner's own profile" })
  @ApiOkResponse({ description: 'Space partner profile.' })
  getMe(@GetUser('id') userId: string) {
    return this.spacesService.getMe(userId);
  }

  @Patch('me')
  @ApiOperation({ summary: "Update the authenticated space partner's profile" })
  @ApiOkResponse({ description: 'Updated space partner profile.' })
  updateMe(@GetUser('id') userId: string, @Body() dto: UpdateSpaceProfileDto) {
    return this.spacesService.updateProfile(userId, dto);
  }

  @Get('community')
  @ApiOperation({ summary: "Get the authenticated space partner's Community Space profile" })
  @ApiOkResponse({ description: 'Community Space profile, or null if not yet activated.' })
  getCommunityProfile(@GetUser('id') userId: string) {
    return this.spacesService.getCommunityProfile(userId);
  }

  @Post('community')
  @ApiOperation({
    summary: 'Activate (create/edit) the Community Space profile',
    description:
      'Creates or edits the public-facing Community Space listing. Resets to PENDING for a new/rejected ' +
      'profile; stages edits as a pendingRevision for an already-APPROVED profile.',
  })
  @ApiOkResponse({ description: 'Community Space profile activated/edited.' })
  activateCommunityProfile(@GetUser('id') userId: string, @Body() dto: ActivateSpaceCommunityDto) {
    return this.spacesService.activateCommunityProfile(userId, dto);
  }

  @Delete('community')
  @ApiOperation({ summary: 'Deactivate the Community Space profile' })
  @ApiOkResponse({ description: 'Community Space profile deactivated.' })
  deactivateCommunityProfile(@GetUser('id') userId: string) {
    return this.spacesService.deactivateCommunityProfile(userId);
  }

  @Get('community/browse')
  @Roles('BRAND', 'HOST')
  @ApiOperation({
    summary: 'List onboarded community spaces (brand/community view)',
    description: 'Full info for admin-approved, non-hidden Community Space profiles — for brands and communities to discover.',
  })
  @ApiOkResponse({ description: 'List of onboarded community spaces.' })
  browseCommunitySpaces() {
    return this.spacesService.listApprovedCommunities();
  }
}
