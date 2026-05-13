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
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { EventsService } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';
import { ListMyEventsQueryDto } from './dto/list-my-events-query.dto';
import { BrowseEventsQueryDto } from './dto/browse-events-query.dto';
import { CancelEventDto } from './dto/cancel-event.dto';

@ApiTags('Events')
@ApiBearerAuth('firebase-token')
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

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
}
