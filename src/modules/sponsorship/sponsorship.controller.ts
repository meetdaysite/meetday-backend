import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { OptionalAuthGuard } from '../../common/guards/optional-auth.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { SponsorshipService } from './sponsorship.service';
import { CreateProposalDto } from './dto/create-proposal.dto';
import { UpdateProposalDto } from './dto/update-proposal.dto';
import { ListProposalsQueryDto } from './dto/list-proposals-query.dto';
import { ListPublishedQueryDto } from './dto/list-published-query.dto';

@ApiTags('Sponsorship Proposals')
@ApiBearerAuth('firebase-token')
@Controller('sponsorships')
export class SponsorshipController {
  constructor(private readonly sponsorshipService: SponsorshipService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new sponsorship proposal draft',
    description:
      'Creates a proposal in DRAFT status. All fields are optional — hosts can save partial data ' +
      'at any step. Use PATCH /sponsorships/:id to update, and PATCH /sponsorships/:id/submit ' +
      'when ready for admin review.',
  })
  @ApiCreatedResponse({ description: 'Proposal draft created.' })
  @ApiForbiddenResponse({ description: 'Host not approved.' })
  @ApiNotFoundResponse({ description: 'Host profile not found.' })
  createProposal(@GetUser('id') userId: string, @Body() dto: CreateProposalDto) {
    return this.sponsorshipService.createProposal(userId, dto);
  }

  @Get('me')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @ApiOperation({
    summary: "List host's own sponsorship proposals",
    description: "Returns the authenticated host's proposals. Filter by `status`.",
  })
  @ApiOkResponse({ description: 'List of proposals.' })
  getMyProposals(@GetUser('id') userId: string, @Query() query: ListProposalsQueryDto) {
    return this.sponsorshipService.getMyProposals(userId, query);
  }

  @Get('published')
  @Public()
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({
    summary: 'List all published sponsorship proposals (data room — public preview)',
    description:
      'Returns every PUBLISHED proposal across all hosts, newest first. Pass `categoryId` to filter ' +
      "by the host's approved community profile category. Accessible without login for the public " +
      'data room link; full proposal detail still requires a BRAND account.',
  })
  @ApiOkResponse({ description: 'List of published proposals.' })
  getAllPublished(@Query() query: ListPublishedQueryDto) {
    return this.sponsorshipService.getAllPublishedProposals(query);
  }

  @Get('communities')
  @UseGuards(RolesGuard)
  @Roles('BRAND')
  @ApiOperation({
    summary: 'List onboarded communities (brand view)',
    description: 'Basic info (logo, name, size, categories) for admin-approved host community profiles.',
  })
  @ApiOkResponse({ description: 'List of onboarded communities.' })
  getCommunities() {
    return this.sponsorshipService.listApprovedCommunities();
  }

  @Get('published/:id')
  @UseGuards(RolesGuard)
  @Roles('BRAND')
  @ApiOperation({
    summary: 'Get a published sponsorship proposal detail (brand view)',
    description: "Full proposal detail plus the host's community profile, for the brand 'data room' view.",
  })
  @ApiOkResponse({ description: 'Proposal detail with community profile.' })
  @ApiNotFoundResponse({ description: 'Proposal not found or not published.' })
  getPublishedDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.sponsorshipService.getPublishedProposalDetail(id);
  }

  @Post('published/:id/interest')
  @UseGuards(RolesGuard)
  @Roles('BRAND')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Mark interest in a published sponsorship proposal',
    description:
      'Notifies admins (full brand details) and anonymously notifies the hosting community. ' +
      'Requires a complete brand profile (name, categories, social links). Idempotent.',
  })
  @ApiOkResponse({ description: 'Interest recorded.' })
  @ApiNotFoundResponse({ description: 'Proposal not found or not published.' })
  @ApiBadRequestResponse({ description: 'Brand profile is incomplete.' })
  markInterest(@GetUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.sponsorshipService.markInterest(userId, id);
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @ApiOperation({ summary: 'Get own proposal detail' })
  @ApiOkResponse({ description: 'Proposal detail.' })
  @ApiNotFoundResponse({ description: 'Proposal not found.' })
  @ApiForbiddenResponse({ description: 'Not the owner.' })
  getProposalDetail(@GetUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.sponsorshipService.getProposalDetail(userId, id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @ApiOperation({
    summary: 'Update a sponsorship proposal',
    description:
      'DRAFT/REJECTED proposals are updated directly. UNDER_REVIEW/PUBLISHED proposals stash the ' +
      'edits as a pending revision awaiting admin approval — the live/submitted version is untouched.',
  })
  @ApiOkResponse({ description: 'Proposal updated (or revision saved).' })
  @ApiNotFoundResponse({ description: 'Proposal not found.' })
  @ApiForbiddenResponse({ description: 'Not the owner.' })
  @ApiBadRequestResponse({ description: 'No changes provided.' })
  updateProposal(
    @GetUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProposalDto,
  ) {
    return this.sponsorshipService.updateProposal(userId, id, dto);
  }

  @Patch(':id/submit')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @ApiOperation({
    summary: 'Submit a proposal for admin review',
    description:
      'Validates all required fields are populated, then moves the proposal to UNDER_REVIEW. ' +
      'Returns a 400 with the list of missing fields if incomplete. Requires an admin-approved ' +
      'community profile (POST /hosts/community) first.',
  })
  @ApiOkResponse({ description: 'Proposal submitted for review.' })
  @ApiForbiddenResponse({ description: 'Not the owner, or proposal is not DRAFT/REJECTED.' })
  @ApiNotFoundResponse({ description: 'Proposal not found.' })
  @ApiBadRequestResponse({
    description: 'Proposal is incomplete, or the community profile is not yet admin-approved.',
  })
  submitProposal(@GetUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.sponsorshipService.submitProposal(userId, id);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a sponsorship proposal',
    description: 'Permanently deletes a proposal. Only allowed when DRAFT or REJECTED.',
  })
  @ApiNoContentResponse({ description: 'Proposal deleted.' })
  @ApiForbiddenResponse({ description: 'Not the owner.' })
  @ApiNotFoundResponse({ description: 'Proposal not found.' })
  @ApiBadRequestResponse({ description: 'Only DRAFT or REJECTED proposals can be deleted.' })
  deleteProposal(@GetUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.sponsorshipService.deleteProposal(userId, id);
  }
}
