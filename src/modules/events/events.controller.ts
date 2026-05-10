import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { EventsService } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';

@ApiTags('Events')
@ApiBearerAuth('firebase-token')
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

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
    @Param('id') eventId: string,
    @Body() dto: CreateEventDto,
  ) {
    return this.eventsService.updateEvent(userId, eventId, dto);
  }

  @Patch(':id/submit')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @ApiOperation({
    summary: 'Submit event draft for admin review',
    description:
      'Validates that all required fields are populated, then moves the event to UNDER_REVIEW. ' +
      'Returns a 400 with a list of missing fields if the event is incomplete.',
  })
  @ApiOkResponse({ description: 'Event submitted for review. Status is now UNDER_REVIEW.' })
  @ApiForbiddenResponse({ description: 'Not the owner, or event is not in DRAFT status.' })
  @ApiNotFoundResponse({ description: 'Event not found.' })
  @ApiBadRequestResponse({ description: 'Event is incomplete. Missing: <field list>.' })
  submitEvent(
    @GetUser('id') userId: string,
    @Param('id') eventId: string,
  ) {
    return this.eventsService.submitEvent(userId, eventId);
  }
}
