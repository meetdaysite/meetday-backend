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
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { OptionalAuthGuard } from '../../common/guards/optional-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { EventsService } from './events.service';
import { EventsVibeService } from './events-vibe.service';
import { CopilotService } from './copilot.service';
import { ReviewsService } from '../reviews/reviews.service';
import { CheckInService } from '../check-in/check-in.service';
import { GraphService } from '../graph/graph.service';
import { CreateScannerSessionDto } from '../check-in/dto/create-scanner-session.dto';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdatePublishedEventDto } from './dto/update-published-event.dto';
import { GenerateDraftDto } from './dto/generate-draft.dto';
import { ListMyEventsQueryDto } from './dto/list-my-events-query.dto';
import { BrowseEventsQueryDto } from './dto/browse-events-query.dto';
import { CancelEventDto } from './dto/cancel-event.dto';
import { VibeMatchDto } from './dto/vibe-match.dto';
import { ListSavedEventsQueryDto } from './dto/list-saved-events-query.dto';

@ApiTags('Events')
@ApiBearerAuth('firebase-token')
@Controller('events')
export class EventsController {
  constructor(
    private readonly eventsService: EventsService,
    private readonly eventsVibeService: EventsVibeService,
    private readonly copilotService: CopilotService,
    private readonly reviewsService: ReviewsService,
    private readonly checkInService: CheckInService,
    private readonly graphService: GraphService,
  ) {}

  // ─── Public endpoints ──────────────────────────────────────────────────────

  @Get()
  @Public()
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({
    summary: 'Browse published events',
    description:
      'Returns paginated published events visible to the public. ' +
      'Filter by city, category, date range, free/paid, or title search. ' +
      'Authenticated callers receive an `isSaved` flag on each event.',
  })
  @ApiOkResponse({ description: 'Paginated list of published events.' })
  browseEvents(@Query() query: BrowseEventsQueryDto, @GetUser('uid') firebaseUid: string | null) {
    return this.eventsService.browseEvents(query, firebaseUid);
  }

  @Get('saved')
  @ApiOperation({ summary: 'List events saved by the authenticated user' })
  @ApiOkResponse({ description: 'Paginated list of saved events. Each item includes `isSaved: true`.' })
  listSavedEvents(@GetUser('uid') firebaseUid: string, @Query() query: ListSavedEventsQueryDto) {
    return this.eventsService.listSavedEvents(firebaseUid, query);
  }

  @Post(':id/save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save an event (idempotent)' })
  @ApiOkResponse({ description: '{ saved: true }' })
  saveEvent(@Param('id', ParseUUIDPipe) id: string, @GetUser('uid') firebaseUid: string) {
    return this.eventsService.saveEvent(id, firebaseUid);
  }

  @Delete(':id/save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unsave an event (idempotent)' })
  @ApiOkResponse({ description: '{ saved: false }' })
  unsaveEvent(@Param('id', ParseUUIDPipe) id: string, @GetUser('uid') firebaseUid: string) {
    return this.eventsService.unsaveEvent(id, firebaseUid);
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
  @UseGuards(OptionalAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get personalised vibe match for an event',
    description:
      'Auth optional. For anonymous callers: pass vibeType, socialStyle, and interests in the body. ' +
      'For authenticated callers: stored profile is used automatically; body is ignored.',
  })
  getVibeMatch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VibeMatchDto,
    @GetUser('id') userId?: string,
  ) {
    return this.eventsVibeService.getVibeMatch(id, dto, userId);
  }

  @Get(':id/crowd-pulse')
  @Public()
  @ApiOperation({
    summary: 'Get crowd pulse for an event',
    description: `Returns the crowd vibe profile for an event's confirmed attendees.

**Numeric scores for bar fills:**
- \`energyScore\` (0–100) — drives the Energy bar fill. Use a red gradient: 0 = empty, 100 = full.
- \`socialScore\` (0–100) — drives the Social Friendliness bar fill. Use a blue gradient.
- \`crowdStyle\` is categorical — map to fixed fills on the frontend:
  - \`"Party Energy"\` → 80%
  - \`"Trendy & Social"\` → 65%
  - \`"Laid-back & Chill"\` → 35%
  - \`"Mixed Crowd"\` → 50%

**When \`isEstimate: true\` (fewer than 5 vibe-typed attendees):**
- \`energyScore\` and \`socialScore\` are \`null\` — render bars in a muted/skeleton state.
- Show a caption such as *"The vibe is still cooking — check back as more people join!"* beneath the bars.
- String labels (\`energy\`, \`crowdStyle\`, \`socialFriendliness\`) are conservative defaults, not real crowd data — avoid displaying them confidently.

**\`confidence\`** (0–1) reflects how much to trust the data; can be shown as a subtitle e.g. *"Based on 3 attendees"* using \`totalAttendees\`.`,
  })
  getCrowdPulse(@Param('id', ParseUUIDPipe) id: string) {
    return this.eventsVibeService.getCrowdPulse(id);
  }

  @Get(':id/social-proximity')
  @ApiOperation({
    summary: "Get the caller's social proximity to an event",
    description:
      'Returns how many of the confirmed attendees the authenticated user has crossed paths with ' +
      'at past events (real-world co-attendance graph), up to 5 avatars, and the strongest ties ' +
      'with shared-event counts. Attendees with PRIVATE profiles are never included.',
  })
  @ApiOkResponse({
    description: 'Social proximity summary.',
    schema: {
      example: {
        knownAttendeeCount: 4,
        avatars: ['https://signed-url-1', 'https://signed-url-2'],
        strongestTies: [{ firstName: 'Priya', sharedEventCount: 3 }],
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Event not found or not published.' })
  getSocialProximity(
    @GetUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.graphService.getSocialProximity(userId, id);
  }

  @Get(':id/public')
  @Public()
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({
    summary: 'Get public event detail',
    description:
      'Returns full detail of a published, public event. ' +
      'Includes all media (presigned S3 URLs), ticket tiers, refund policy, host trust signals, ' +
      'vibe summary, crowd pulse, what-to-expect, and a computed startingPrice. ' +
      'Authenticated callers receive an `isSaved` flag.',
  })
  @ApiOkResponse({ description: 'Event detail with signed media URLs.' })
  @ApiNotFoundResponse({ description: 'Event not found or not publicly available.' })
  getPublicEvent(@Param('id', ParseUUIDPipe) id: string, @GetUser('uid') firebaseUid: string | null) {
    return this.eventsService.getPublicEventById(id, firebaseUid);
  }

  @Get(':id/pricing-config')
  @Public()
  @ApiOperation({
    summary: 'Get pricing config for an event',
    description:
      'Returns the effective platform fee rate and GST rate for an event. ' +
      'The frontend uses these values to compute the full price breakdown dynamically ' +
      'before the user places an order.',
  })
  @ApiOkResponse({
    description: 'Effective rates for client-side price preview.',
    schema: {
      example: {
        platformFeeRate: 0.08,
        gstRate: 0.18,
        platformFeeWaived: false,
        hostFeePromoApplied: true,
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Event not found.' })
  getEventPricingConfig(@Param('id', ParseUUIDPipe) id: string) {
    return this.eventsService.getEventPricingConfig(id);
  }

  @Get(':id/available-offers')
  @UseGuards(RolesGuard)
  @Roles('USER')
  @ApiOperation({
    summary: 'List available promo codes for an event',
    description:
      'Returns active, event-specific ATTENDEE promo codes that the authenticated user can still redeem. ' +
      'Codes the user has already exhausted their per-user limit on are excluded. ' +
      'Platform-wide codes (not tied to a specific event) are not surfaced here — those are communicated via push/email.',
  })
  @ApiOkResponse({
    description: 'List of applicable promo offers.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-07-01T10:00:00.000Z',
        data: [
          {
            code: 'EARLYBIRD',
            description: 'Early bird — 30% off tickets',
            discountType: 'PERCENTAGE',
            discountValue: 30,
            maxDiscountAmount: 300,
            minOrderValue: null,
            validUntil: '2026-08-01T23:59:59.000Z',
          },
        ],
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Event not found or not published.' })
  getAvailableOffers(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') userId: string,
  ) {
    return this.eventsService.getAvailableOffers(id, userId);
  }

  // ─── Host endpoints ────────────────────────────────────────────────────────

  @Post('copilot/generate-draft')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @ApiOperation({
    summary: 'Generate an event draft using AI Copilot',
    description: 'Accepts a natural language prompt from the host and returns a fully structured event draft generated by the Meetday AI Copilot.',
  })
  @ApiOkResponse({ description: 'AI-generated event draft.' })
  @ApiForbiddenResponse({ description: 'Host role required.' })
  @ApiBadRequestResponse({ description: 'Prompt too short, too long, or contains unfilled placeholders.' })
  generateDraft(
    @GetUser('uid') uid: string,
    @Body() dto: GenerateDraftDto,
  ) {
    return this.copilotService.generateDraft(dto.prompt, uid);
  }


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
    description: "Returns full detail of one of the host's own events regardless of status.",
  })
  @ApiOkResponse({
    description: 'Full event detail.',
    schema: {
      example: {
        id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        hostProfileId: 'b2c3d4e5-f6a7-8901-bcde-f01234567891',
        categoryId: 'c3d4e5f6-a7b8-9012-cdef-012345678902',
        title: 'Morning Yoga by the Lake',
        description: 'A rejuvenating outdoor yoga session for all skill levels.',
        eventType: 'IN_PERSON',
        languages: ['English', 'Hindi'],
        tags: ['yoga', 'wellness', 'outdoor'],
        eventDate: '2026-08-15T00:00:00.000Z',
        startTime: '07:00',
        endTime: '08:30',
        venueName: 'Lodhi Garden',
        fullAddress: 'Lodhi Road, New Delhi, Delhi 110003',
        city: 'New Delhi',
        latitude: '28.5933',
        longitude: '77.2198',
        whatToExpect: ['Guided breathing exercises', 'Asana flow', 'Meditation cool-down'],
        whoShouldAttend: ['Beginners welcome', 'Bring your own mat'],
        visibility: 'PUBLIC',
        ageRestriction: '18+',
        specialInstructions: 'Wear comfortable clothing. Arrive 10 minutes early.',
        vibeSummary: null,
        crowdPulse: null,
        isFree: false,
        platformFeeWaived: false,
        adminRejectionRemark: null,
        reviewedBy: null,
        reviewedAt: null,
        cancelledAt: null,
        cancellationReason: null,
        submittedAt: null,
        graphProcessedAt: null,
        status: 'DRAFT',
        createdAt: '2026-07-01T10:00:00.000Z',
        updatedAt: '2026-07-01T10:00:00.000Z',
        tickets: [
          {
            id: 'd4e5f6a7-b8c9-0123-defa-123456789003',
            eventId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            name: 'General Admission',
            price: '499.00',
            isFree: false,
            totalCapacity: 30,
            soldCount: 0,
            maxPerPerson: 2,
            description: 'Standard entry ticket.',
            saleStartDate: '2026-07-10T00:00:00.000Z',
            saleEndDate: '2026-08-14T23:59:59.000Z',
            createdAt: '2026-07-01T10:00:00.000Z',
            updatedAt: '2026-07-01T10:00:00.000Z',
          },
        ],
        refundPolicy: {
          id: 'e5f6a7b8-c9d0-1234-efab-234567890104',
          eventId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          type: 'PARTIAL',
          cutoffHours: 24,
          refundPercent: 80,
          refundTo: 'ORIGINAL_PAYMENT',
        },
        category: {
          id: 'c3d4e5f6-a7b8-9012-cdef-012345678902',
          name: 'Wellness',
        },
        hostProfile: {
          id: 'b2c3d4e5-f6a7-8901-bcde-f01234567891',
          displayName: 'Priya Wellness Co.',
          userId: 'f6a7b8c9-d0e1-2345-fabc-345678901205',
        },
        media: [
          {
            id: 'a7b8c9d0-e1f2-3456-abcd-456789012306',
            eventId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            url: 'https://cdn.example.com/media/cover.jpg?X-Amz-Expires=3600&...',
            type: 'COVER',
            order: 0,
            createdAt: '2026-07-01T10:00:00.000Z',
          },
          {
            id: 'b8c9d0e1-f2a3-4567-bcde-567890123407',
            eventId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            url: 'https://cdn.example.com/media/gallery1.jpg?X-Amz-Expires=3600&...',
            type: 'GALLERY',
            order: 1,
            createdAt: '2026-07-01T10:00:00.000Z',
          },
        ],
        communities: [
          {
            id: 'c9d0e1f2-a3b4-5678-cdef-678901234508',
            slug: 'delhi-wellness-collective',
            name: 'Delhi Wellness Collective',
            description: 'A community for wellness enthusiasts in Delhi.',
            type: 'PUBLIC',
            access: 'OPEN',
            city: 'New Delhi',
            memberCount: 342,
            upcomingExperiencesCount: 5,
            source: 'MANUAL',
            coverImageUrl: 'https://cdn.example.com/communities/cover.jpg?X-Amz-Expires=3600&...',
            iconUrl: 'https://cdn.example.com/communities/icon.png?X-Amz-Expires=3600&...',
          },
        ],
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Event not found.' })
  @ApiForbiddenResponse({ description: 'Event belongs to a different host.' })
  getMyEventById(
    @GetUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.eventsService.getMyEventById(userId, id);
  }

  @Get('me/:id/attendees')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @ApiOperation({
    summary: 'List attendees for own event',
    description:
      "Returns a paginated list of all confirmed attendees for the host's event. " +
      'Defaults to page 1, limit 50.',
  })
  @ApiOkResponse({
    description: 'Paginated attendee list.',
    schema: {
      example: {
        attendees: [
          {
            firstName: 'Rohan',
            lastName: 'Mehta',
            ticketType: 'General Admission',
            bookingDate: '2026-07-20T14:32:00.000Z',
            bookingId: 'BK-20260720-0001',
            amountPaid: '499.00',
            isCheckedIn: true,
            checkedInAt: '2026-08-15T06:58:00.000Z',
          },
          {
            firstName: 'Ananya',
            lastName: 'Sharma',
            ticketType: 'General Admission',
            bookingDate: '2026-07-22T09:10:00.000Z',
            bookingId: 'BK-20260722-0003',
            amountPaid: '499.00',
            isCheckedIn: false,
            checkedInAt: null,
          },
        ],
        total: 24,
        page: 1,
        limit: 50,
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Event not found.' })
  @ApiForbiddenResponse({ description: 'Event belongs to a different host.' })
  getEventAttendees(
    @GetUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.eventsService.getEventAttendees(userId, id, page, limit);
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

  @Patch(':id/revision')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @ApiOperation({
    summary: 'Propose edits to a published event',
    description:
      'Submits host edits to an already-PUBLISHED event as an admin-reviewed revision. The live ' +
      'event stays public and unchanged until an admin approves the revision. Only content fields ' +
      '(title, description, media, tags, languages, whatToExpect, whoShouldAttend, specialInstructions, ' +
      'eventType, categoryId) and the venue block (venueName, fullAddress, city, latitude, longitude) ' +
      'can be edited — date/time, tickets, refund policy, isFree, visibility and ageRestriction are ' +
      'locked. Whenever any location field changes, latitude + longitude must be sent with it. ' +
      'Media replaces the full set (send existing keys + new ones). Re-submitting replaces the ' +
      'single pending revision. An approved venue change notifies confirmed attendees.',
  })
  @ApiOkResponse({ description: 'Revision saved and pending admin review.' })
  @ApiForbiddenResponse({ description: 'Not the owner, or event is not PUBLISHED.' })
  @ApiNotFoundResponse({ description: 'Event or category not found.' })
  @ApiBadRequestResponse({ description: 'No changes provided, or a locked field was sent.' })
  updateEventRevision(
    @GetUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePublishedEventDto,
  ) {
    return this.eventsService.upsertRevision(userId, id, dto);
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
  @ApiBody({ type: CreateScannerSessionDto })
  @ApiCreatedResponse({
    description:
      'Scanner session created and invite email sent to the staff member. ' +
      'The session auto-expires one hour after the event end time. `scannerUrl` is the link staff open — ' +
      'no login required.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-05-16T10:00:00.000Z',
        data: {
          id: 'session-uuid',
          eventId: 'event-uuid',
          staffName: 'Rahul Sharma',
          staffEmail: 'rahul@example.com',
          staffPhone: '+919876543210',
          label: 'Gate A',
          token: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
          isActive: true,
          expiresAt: '2026-05-24T23:59:00.000Z',
          createdAt: '2026-05-16T10:00:00.000Z',
          scannerUrl: 'https://app.meetday.app/scan?token=a1b2c3d4...',
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Event has no date/end time set, or the end time format is unrecognised.' })
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
    description: 'Returns all scanner sessions for the event, newest first, each with its per-session check-in count and scanner link.',
  })
  @ApiOkResponse({
    description: 'List of scanner sessions with check-in counts.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-07-03T10:00:00.000Z',
        data: [
          {
            id: 'session-uuid',
            eventId: 'event-uuid',
            staffName: 'Rahul Sharma',
            staffEmail: 'rahul@example.com',
            staffPhone: '+919876543210',
            label: 'Gate A',
            token: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
            isActive: true,
            expiresAt: '2026-07-12T23:00:00.000Z',
            createdAt: '2026-07-03T09:00:00.000Z',
            checkInCount: 42,
            scannerUrl: 'https://app.meetday.app/scan?token=a1b2c3d4...',
          },
        ],
      },
    },
  })
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
    description: "Revokes a staff member's scanner link before it expires. Any further use of that link returns 410 Gone.",
  })
  @ApiParam({ name: 'sessionId', description: 'Scanner session UUID', example: 'session-uuid-1234' })
  @ApiOkResponse({
    description: 'Session deactivated. Returns the updated session record.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-07-03T10:00:00.000Z',
        data: {
          id: 'session-uuid',
          eventId: 'event-uuid',
          staffName: 'Rahul Sharma',
          label: 'Gate A',
          isActive: false,
          expiresAt: '2026-07-12T23:00:00.000Z',
          createdAt: '2026-07-03T09:00:00.000Z',
        },
      },
    },
  })
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
    description:
      'Host-facing dashboard stats. Returns total, checked-in, and remaining attendee counts across all ' +
      'confirmed orders, plus a per-gate (per-session) breakdown. Only the event owner can call this.',
  })
  @ApiOkResponse({
    description: 'Check-in statistics for the event.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-07-03T10:00:00.000Z',
        data: {
          totalAttendees: 160,
          checkedIn: 42,
          remaining: 118,
          bySession: [
            {
              id: 'session-uuid',
              staffName: 'Rahul Sharma',
              staffEmail: 'rahul@example.com',
              label: 'Gate A',
              isActive: true,
              expiresAt: '2026-07-12T23:00:00.000Z',
              checkInCount: 42,
            },
          ],
        },
      },
    },
  })
  @ApiForbiddenResponse({ description: 'Caller does not own this event.' })
  @ApiNotFoundResponse({ description: 'Event not found.' })
  getCheckInStats(
    @GetUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.checkInService.getCheckInStats(userId, id);
  }
}
