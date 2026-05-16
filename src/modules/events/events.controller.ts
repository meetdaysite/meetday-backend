import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
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
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { EventsService } from './events.service';
import { EventsVibeService } from './events-vibe.service';
import { ReviewsService } from '../reviews/reviews.service';
import { CheckInService } from '../check-in/check-in.service';
import { CreateScannerSessionDto } from '../check-in/dto/create-scanner-session.dto';
import { CreateEventDto } from './dto/create-event.dto';
import { ListMyEventsQueryDto } from './dto/list-my-events-query.dto';
import { BrowseEventsQueryDto } from './dto/browse-events-query.dto';
import { CancelEventDto } from './dto/cancel-event.dto';
import { VibeMatchDto } from './dto/vibe-match.dto';

@ApiTags('Events')
@ApiBearerAuth('firebase-token')
@Controller('events')
export class EventsController {
  constructor(
    private readonly eventsService: EventsService,
    private readonly eventsVibeService: EventsVibeService,
    private readonly reviewsService: ReviewsService,
    private readonly checkInService: CheckInService,
  ) {}

  // ─── Public endpoints ──────────────────────────────────────────────────────

  @Get()
  @Public()
  @ApiOperation({
    summary: 'Browse published events',
    description:
      'Returns paginated published events visible to the public. ' +
      'Filter by city, category, date range, free/paid, or title search.',
  })
  @ApiOkResponse({ description: 'Paginated list of published events.' })
  browseEvents(@Query() query: BrowseEventsQueryDto) {
    return this.eventsService.browseEvents(query);
  }

  @Get(':id/reviews')
  @Public()
  @ApiOperation({ summary: 'Get reviews for a published event' })
  @ApiOkResponse({ description: 'Paginated reviews with average rating.' })
  getEventReviews(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.reviewsService.getEventReviews(id, page, limit);
  }

  @Post(':id/vibe-match')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get personalised vibe match for an event',
    description:
      'Stateless, no auth required. Pass vibeType, socialStyle, and interests with affinity ' +
      '(LIKED / DISLIKED / OPEN_TO) to receive a 0–100 score, 3 reason blocks, and similar attendee avatars.',
  })
  getVibeMatch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VibeMatchDto,
  ) {
    return this.eventsVibeService.getVibeMatch(id, dto);
  }

  @Get(':id/crowd-pulse')
  @Public()
  @ApiOperation({
    summary: 'Get crowd pulse for an event',
    description: 'Returns energy level, crowd style, social friendliness, and top attendee avatars.',
  })
  getCrowdPulse(@Param('id', ParseUUIDPipe) id: string) {
    return this.eventsVibeService.getCrowdPulse(id);
  }

  @Get(':id/public')
  @Public()
  @ApiOperation({
    summary: 'Get public event detail',
    description:
      'Returns full detail of a published, public event. ' +
      'Includes all media (presigned S3 URLs), ticket tiers, refund policy, host trust signals, ' +
      'vibe summary, crowd pulse, what-to-expect, and a computed startingPrice.',
  })
  @ApiOkResponse({ description: 'Event detail with signed media URLs.' })
  @ApiNotFoundResponse({ description: 'Event not found or not publicly available.' })
  getPublicEvent(@Param('id', ParseUUIDPipe) id: string) {
    return this.eventsService.getPublicEventById(id);
  }

  // ─── Host endpoints ────────────────────────────────────────────────────────

  @Post()
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new event draft',
    description:
      'Creates an event in DRAFT status. All fields are optional — hosts can save partial data ' +
      'at any step of the creation form. Use PATCH /events/:id to update, and ' +
      'PATCH /events/:id/submit when ready for admin review.',
  })
  @ApiCreatedResponse({ description: 'Event draft created.' })
  @ApiForbiddenResponse({ description: 'Host not approved or does not have HOST role.' })
  @ApiNotFoundResponse({ description: 'Host profile or category not found.' })
  @ApiBadRequestResponse({ description: 'Ticket prices must be 0 for a free event.' })
  createEvent(
    @GetUser('id') userId: string,
    @Body() dto: CreateEventDto,
  ) {
    return this.eventsService.createEvent(userId, dto);
  }

  @Get('me')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @ApiOperation({
    summary: "List host's own events",
    description: 'Returns the authenticated host\'s events. Filter by status.',
  })
  @ApiOkResponse({ description: 'Paginated list of host events.' })
  getMyEvents(
    @GetUser('id') userId: string,
    @Query() query: ListMyEventsQueryDto,
  ) {
    return this.eventsService.getMyEvents(userId, query);
  }

  @Get('me/:id')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @ApiOperation({
    summary: 'Get own event detail',
    description: 'Returns full detail of one of the host\'s own events regardless of status.',
  })
  @ApiOkResponse({ description: 'Full event detail.' })
  @ApiNotFoundResponse({ description: 'Event not found.' })
  @ApiForbiddenResponse({ description: 'Event belongs to a different host.' })
  getMyEventById(
    @GetUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.eventsService.getMyEventById(userId, id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @ApiOperation({
    summary: 'Update an event draft',
    description:
      'Partially updates a DRAFT event. Only fields present in the request body are updated. ' +
      'If tickets are provided they replace all existing tickets. ' +
      'If refundPolicy is provided it is upserted.',
  })
  @ApiOkResponse({ description: 'Event draft updated.' })
  @ApiForbiddenResponse({ description: 'Not the owner, or event is not in DRAFT status.' })
  @ApiNotFoundResponse({ description: 'Event or category not found.' })
  @ApiBadRequestResponse({ description: 'Ticket prices must be 0 for a free event.' })
  updateEvent(
    @GetUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateEventDto,
  ) {
    return this.eventsService.updateEvent(userId, id, dto);
  }

  @Patch(':id/submit')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @ApiOperation({
    summary: 'Submit event draft for admin review',
    description:
      'Validates that all required fields are populated and eventDate is in the future, ' +
      'then moves the event to UNDER_REVIEW. ' +
      'Returns a 400 with a list of missing fields if the event is incomplete.',
  })
  @ApiOkResponse({ description: 'Event submitted for review. Status is now UNDER_REVIEW.' })
  @ApiForbiddenResponse({ description: 'Not the owner, or event is not in DRAFT status.' })
  @ApiNotFoundResponse({ description: 'Event not found.' })
  @ApiBadRequestResponse({ description: 'Event is incomplete. Missing: <field list>.' })
  submitEvent(
    @GetUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.eventsService.submitEvent(userId, id);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a draft event',
    description: 'Permanently deletes an event. Only allowed when the event is in DRAFT status.',
  })
  @ApiNoContentResponse({ description: 'Event deleted.' })
  @ApiForbiddenResponse({ description: 'Not the owner.' })
  @ApiNotFoundResponse({ description: 'Event not found.' })
  @ApiBadRequestResponse({ description: 'Only DRAFT events can be deleted.' })
  deleteEvent(
    @GetUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.eventsService.deleteEvent(userId, id);
  }

  @Patch(':id/cancel')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @ApiOperation({
    summary: 'Cancel a published event',
    description: 'Cancels a PUBLISHED event. Requires a cancellation reason.',
  })
  @ApiOkResponse({ description: 'Event cancelled.' })
  @ApiForbiddenResponse({ description: 'Not the owner.' })
  @ApiNotFoundResponse({ description: 'Event not found.' })
  @ApiBadRequestResponse({ description: 'Only PUBLISHED events can be cancelled.' })
  cancelEvent(
    @GetUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelEventDto,
  ) {
    return this.eventsService.cancelEvent(userId, id, dto);
  }

  // ─── Scanner session endpoints ─────────────────────────────────────────────

  @Post(':id/scanner-sessions')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @ApiOperation({
    summary: 'Invite staff to scan tickets',
    description:
      'Creates a time-limited scanner link for a staff member and emails it to them. No login is required to use the link.',
  })
  @ApiCreatedResponse({
    description: 'Scanner session created and invite email sent to staff member.',
    schema: {
      example: {
        id: 'uuid',
        eventId: 'uuid',
        staffName: 'Rahul Sharma',
        staffEmail: 'rahul@example.com',
        staffPhone: '+919876543210',
        label: 'Gate A',
        isActive: true,
        expiresAt: '2026-05-24T23:59:00.000Z',
        createdAt: '2026-05-16T10:00:00.000Z',
        scannerUrl: 'https://app.meetday.app/scan?token=abc123',
      },
    },
  })
  @ApiBadRequestResponse({ description: 'expiresAt is in the past.' })
  @ApiForbiddenResponse({ description: 'Caller does not own this event.' })
  @ApiNotFoundResponse({ description: 'Event not found.' })
  createScannerSession(
    @GetUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateScannerSessionDto,
  ) {
    return this.checkInService.createScannerSession(userId, id, dto);
  }

  @Get(':id/scanner-sessions')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @ApiOperation({
    summary: 'List staff scanner sessions',
    description: 'Returns all scanner sessions for the event, including per-session check-in counts.',
  })
  @ApiOkResponse({ description: 'List of scanner sessions with check-in counts.' })
  @ApiForbiddenResponse({ description: 'Caller does not own this event.' })
  @ApiNotFoundResponse({ description: 'Event not found.' })
  listScannerSessions(
    @GetUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.checkInService.listScannerSessions(userId, id);
  }

  @Patch(':id/scanner-sessions/:sessionId/deactivate')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @ApiOperation({
    summary: 'Deactivate a scanner session',
    description: "Revokes a staff member's scanner link before it expires.",
  })
  @ApiOkResponse({ description: 'Session deactivated.' })
  @ApiBadRequestResponse({ description: 'Session is already inactive.' })
  @ApiForbiddenResponse({ description: 'Caller does not own this event.' })
  @ApiNotFoundResponse({ description: 'Session not found.' })
  deactivateScannerSession(
    @GetUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ) {
    return this.checkInService.deactivateScannerSession(userId, id, sessionId);
  }

  @Get(':id/check-in-stats')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @ApiOperation({
    summary: 'Get real-time check-in stats',
    description: 'Returns total, checked-in, and remaining attendee counts, with a per-session breakdown.',
  })
  @ApiOkResponse({ description: 'Check-in statistics.' })
  @ApiForbiddenResponse({ description: 'Caller does not own this event.' })
  @ApiNotFoundResponse({ description: 'Event not found.' })
  getCheckInStats(
    @GetUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.checkInService.getCheckInStats(userId, id);
  }
}
