import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SupportTicketService } from './support-ticket.service';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';
import { ListSupportTicketsQueryDto } from './dto/list-support-tickets-query.dto';
import { AssignSupportTicketDto } from './dto/assign-support-ticket.dto';
import { ResolveSupportTicketDto } from './dto/resolve-support-ticket.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GetUser } from '../../common/decorators/get-user.decorator';

@ApiTags('Support Tickets')
@ApiBearerAuth('firebase-token')
@ApiUnauthorizedResponse({ description: 'Missing or invalid Firebase JWT' })
@Controller('support-tickets')
export class SupportTicketController {
  constructor(private readonly supportTicketService: SupportTicketService) {}

  @Post()
  @ApiOperation({ summary: 'Create a support ticket (any authenticated user)' })
  @ApiOkResponse({ description: 'Ticket created.' })
  create(@GetUser('id') userId: string, @Body() dto: CreateSupportTicketDto) {
    return this.supportTicketService.create(userId, dto);
  }

  @Get('admin')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'CITY_ADMIN', 'SUPPORT')
  @ApiForbiddenResponse({ description: 'Insufficient role' })
  @ApiOperation({ summary: 'List support tickets (admin)' })
  @ApiOkResponse({ description: 'Paginated list of tickets.' })
  list(@Query() query: ListSupportTicketsQueryDto) {
    return this.supportTicketService.list(query);
  }

  @Get('admin/:id')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'CITY_ADMIN', 'SUPPORT')
  @ApiForbiddenResponse({ description: 'Insufficient role' })
  @ApiNotFoundResponse({ description: 'Ticket not found' })
  @ApiOperation({ summary: 'Get support ticket detail (admin)' })
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.supportTicketService.getById(id);
  }

  @Post('admin/:id/assign')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'CITY_ADMIN', 'SUPPORT')
  @ApiForbiddenResponse({ description: 'Insufficient role' })
  @ApiNotFoundResponse({ description: 'Ticket not found' })
  @ApiOperation({ summary: 'Assign ticket to an admin user' })
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') adminId: string,
    @Body() dto: AssignSupportTicketDto,
  ) {
    return this.supportTicketService.assign(id, adminId, dto);
  }

  @Post('admin/:id/resolve')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'CITY_ADMIN', 'SUPPORT')
  @ApiForbiddenResponse({ description: 'Insufficient role' })
  @ApiNotFoundResponse({ description: 'Ticket not found' })
  @ApiOperation({ summary: 'Resolve a support ticket with a resolution note' })
  resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') adminId: string,
    @Body() dto: ResolveSupportTicketDto,
  ) {
    return this.supportTicketService.resolve(id, adminId, dto);
  }

  @Post('admin/:id/close')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'CITY_ADMIN', 'SUPPORT')
  @ApiForbiddenResponse({ description: 'Insufficient role' })
  @ApiNotFoundResponse({ description: 'Ticket not found' })
  @ApiOperation({ summary: 'Close a support ticket' })
  close(@Param('id', ParseUUIDPipe) id: string, @GetUser('id') adminId: string) {
    return this.supportTicketService.close(id, adminId);
  }
}
