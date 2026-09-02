import { Body, Controller, DefaultValuePipe, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SupportTicketStatus } from '@prisma/client';
import { SupportTicketService } from './support-ticket.service';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';
import { ListSupportTicketsQueryDto } from './dto/list-support-tickets-query.dto';
import { AssignSupportTicketDto } from './dto/assign-support-ticket.dto';
import { ResolveSupportTicketDto } from './dto/resolve-support-ticket.dto';
import { EscalateTicketDto } from './dto/escalate-support-ticket.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GetUser } from '../../common/decorators/get-user.decorator';

// ─── Shared response shapes used across multiple @ApiOkResponse decorators ────

const TICKET_OPEN_EXAMPLE = {
  id: 'a1b2c3d4-0e1f-2a3b-4c5d-6e7f8a9b0c1d',
  ticketNumber: 'TKT-20260701-X4KR',
  subject: 'Payment deducted but ticket not confirmed',
  body: 'I completed the payment of ₹499 for Jazz Night at Koramangala but my ticket still shows as pending. The amount was debited from my UPI account (Ref: UPI20260701XXXX). Please check and issue the ticket or initiate a refund.',
  category: 'PAYMENT_ISSUE',
  priority: 'HIGH',
  status: 'OPEN',
  entityType: 'ORDER',
  entityId: 'd4f3e2a1-9c1b-4e8a-b3f0-1a2b3c4d5e6f',
  resolution: null,
  resolvedAt: null,
  createdAt: '2026-07-01T10:30:00.000Z',
  updatedAt: '2026-07-01T10:30:00.000Z',
  reporter: { id: 'c1d2e3f4-0a1b-2c3d-4e5f-6a7b8c9d0e1f', firstName: 'Aishik', lastName: 'Sikdar', email: 'aishik@freeflow.zone' },
  assignee: null,
  resolver: null,
};

const TICKET_IN_PROGRESS_EXAMPLE = {
  ...TICKET_OPEN_EXAMPLE,
  status: 'IN_PROGRESS',
  updatedAt: '2026-07-01T11:05:00.000Z',
  assignee: { id: 'adm1-uuid-0000-0000-000000000001', firstName: 'Priya', lastName: 'Sharma' },
};

const TICKET_RESOLVED_EXAMPLE = {
  ...TICKET_IN_PROGRESS_EXAMPLE,
  status: 'RESOLVED',
  resolution: 'We verified the UPI transaction and confirmed the debit. A fresh ticket has been issued and emailed to the reporter. If the issue persists please reply to this ticket.',
  resolvedAt: '2026-07-01T14:20:00.000Z',
  updatedAt: '2026-07-01T14:20:00.000Z',
  resolver: { id: 'adm1-uuid-0000-0000-000000000001', firstName: 'Priya', lastName: 'Sharma' },
};

const TICKET_CLOSED_EXAMPLE = {
  ...TICKET_RESOLVED_EXAMPLE,
  status: 'CLOSED',
  updatedAt: '2026-07-01T16:00:00.000Z',
};

// ─────────────────────────────────────────────────────────────────────────────

@ApiTags('Support Tickets')
@ApiBearerAuth('firebase-token')
@ApiUnauthorizedResponse({ description: 'Missing or invalid Firebase JWT' })
@Controller('support-tickets')
export class SupportTicketController {
  constructor(private readonly supportTicketService: SupportTicketService) {}

  // ── POST / ─────────────────────────────────────────────────────────────────

  @Post()
  @UseGuards(RolesGuard)
  @Roles('USER', 'HOST')
  @ApiForbiddenResponse({ description: 'Insufficient role — must be USER or HOST' })
  @ApiOperation({
    summary: 'Create a support ticket (any authenticated user)',
    description: `
Submit a new support ticket on behalf of the authenticated user.

If \`priority\` is omitted the database persists **NORMAL** as the default.
The client is responsible for deriving the correct priority using the hierarchy below.
**URGENT is admin-only and must never be sent at creation.**

---

### Priority hierarchy — category × entityType

#### URGENT
Reserved for admin escalation after a ticket is already open.
Do **not** include \`"priority": "URGENT"\` in a creation request.

#### HIGH — set when money or a host account is at stake
| Trigger | Reason |
|---------|--------|
| \`category = PAYMENT_ISSUE\` | Failed charge, duplicate billing, or payment gateway error |
| \`category = REFUND_REQUEST\` | Financial reversal request for any order |
| \`category = HOST_ISSUE\` | Affects host payout, host account standing, or listing removal |
| \`category = EVENT_ISSUE\` **and** \`entityType = ORDER\` | Broken/cancelled event tied to an existing order |
| **Any** category **and** \`entityType = ORDER\` | A financial transaction record is the subject of the ticket |

#### NORMAL — set for access, UX, and platform problems
| Trigger | Reason |
|---------|--------|
| \`category = ACCOUNT_ISSUE\` | Login failures, profile errors, KYC / verification stuck |
| \`category = EVENT_ISSUE\` (no ORDER entity) | General event complaint — wrong info, late updates, venue change |
| \`category = COMMUNITY_ISSUE\` | Community access, moderation dispute, banned user |
| Any category + \`entityType = USER\` | Issue scoped to a user profile or account record |
| Any category + \`entityType = EVENT\` | Issue scoped to an event listing (no order involved) |
| Any category + \`entityType = COMMUNITY\` | Issue scoped to a community |

#### LOW — set for unclassified feedback
| Trigger | Reason |
|---------|--------|
| \`category = OTHER\` with no \`entityId\` | General feedback, feature requests, or uncategorised queries |
| \`category = OTHER\` with any \`entityType\` | Soft complaint not linked to a transaction |

---

**Quick rule:** money or host account → **HIGH** · platform problem → **NORMAL** · generic feedback → **LOW**
    `,
  })
  @ApiBody({
    type: CreateSupportTicketDto,
    examples: {
      high_payment_issue: {
        summary: 'HIGH · Payment failed (ORDER entity)',
        description:
          'category=PAYMENT_ISSUE always maps to HIGH. ' +
          'entityType=ORDER + entityId lets admins pull the exact order record from the dashboard.',
        value: {
          subject: 'Payment deducted but ticket not confirmed',
          body: 'I completed the payment of ₹499 for Jazz Night at Koramangala but my ticket still shows as pending. The amount was debited from my UPI account (Ref: UPI20260701XXXX). Please check and issue the ticket or initiate a refund.',
          category: 'PAYMENT_ISSUE',
          priority: 'HIGH',
          entityType: 'ORDER',
          entityId: 'd4f3e2a1-9c1b-4e8a-b3f0-1a2b3c4d5e6f',
        },
      },
      high_refund_request: {
        summary: 'HIGH · Refund for cancelled event',
        description:
          'category=REFUND_REQUEST is always HIGH. ' +
          'entityType=EVENT lets admins verify cancellation status before approving the refund.',
        value: {
          subject: 'Refund for cancelled event – Rooftop Rave 2025',
          body: 'The host cancelled Rooftop Rave 2025 (event ID below) two days before the scheduled date without any notice. I paid ₹799 for two tickets and would like a full refund. Please process this at the earliest.',
          category: 'REFUND_REQUEST',
          priority: 'HIGH',
          entityType: 'EVENT',
          entityId: 'b2c3d4e5-1a2b-3c4d-5e6f-7a8b9c0d1e2f',
        },
      },
      high_host_issue: {
        summary: 'HIGH · Host payout not received',
        description:
          'category=HOST_ISSUE is always HIGH because it affects host revenue and platform trust. ' +
          'entityType=HOST scopes the ticket to the host profile record.',
        value: {
          subject: 'Payout for July events not received',
          body: 'My scheduled payout of ₹12,400 for events hosted in the first week of July has not been credited to my registered bank account. The payout dashboard shows "processing" for over 5 days. Please investigate.',
          category: 'HOST_ISSUE',
          priority: 'HIGH',
          entityType: 'HOST',
          entityId: 'e5f6a7b8-2c3d-4e5f-6a7b-8c9d0e1f2a3b',
        },
      },
      normal_account_issue: {
        summary: 'NORMAL · Account / profile problem',
        description:
          'category=ACCOUNT_ISSUE is NORMAL. ' +
          "No entityId needed when the issue is on the reporter's own account — reporter is inferred from the auth token.",
        value: {
          subject: 'Unable to update profile photo',
          body: 'Every time I try to upload a new profile photo the app shows "Something went wrong". I have tried on both Wi-Fi and mobile data, and on two different phones. The issue has persisted for 3 days.',
          category: 'ACCOUNT_ISSUE',
          entityType: 'USER',
        },
      },
      normal_event_issue: {
        summary: 'NORMAL · Event listing complaint (no order)',
        description:
          'category=EVENT_ISSUE without an ORDER entity → NORMAL. ' +
          'If the reporter had an order, entityType=ORDER would push this to HIGH.',
        value: {
          subject: 'Event venue changed without any notification',
          body: 'The venue for Open Mic Night (July 5) was changed from Koramangala Social to Indiranagar. No push notification or email was sent. Several attendees including myself were stranded at the original location.',
          category: 'EVENT_ISSUE',
          priority: 'NORMAL',
          entityType: 'EVENT',
          entityId: 'f6a7b8c9-3d4e-5f6a-7b8c-9d0e1f2a3b4c',
        },
      },
      low_other_feedback: {
        summary: 'LOW · General feedback (no entity)',
        description:
          'category=OTHER with no entityId → LOW. ' +
          'Omitting priority lets the DB default to NORMAL, but LOW is more accurate for unactionable feedback.',
        value: {
          subject: 'Suggestion – add dark mode to the app',
          body: 'The app would be much more comfortable to use in low-light environments if a dark mode option were available. Several members of the Bangalore community have mentioned this. Happy to test a beta version if one is available.',
          category: 'OTHER',
          priority: 'LOW',
        },
      },
    },
  })
  @ApiOkResponse({
    description: 'Ticket created successfully.',
    schema: { example: TICKET_OPEN_EXAMPLE },
  })
  create(
    @GetUser('id') userId: string,
    @GetUser('role') userRole: string,
    @Body() dto: CreateSupportTicketDto,
  ) {
    return this.supportTicketService.create(userId, userRole, dto);
  }

  // ── GET /me ─────────────────────────────────────────────────────────────────

  @Get('me')
  @UseGuards(RolesGuard)
  @Roles('USER', 'HOST')
  @ApiForbiddenResponse({ description: 'Insufficient role — must be USER or HOST' })
  @ApiOperation({
    summary: 'List my support tickets',
    description: `
Returns a paginated list of support tickets submitted by the authenticated user, ordered by most recent first.

Each item includes the current \`status\` so the user can track whether their ticket is open, being worked on, or resolved.
For the full resolution note, fetch the individual ticket via \`GET /support-tickets/me/:id\`.
    `,
  })
  @ApiQuery({ name: 'status', required: false, enum: SupportTicketStatus, description: 'Filter by ticket status.' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Page number (1-indexed).' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: 'Items per page (1–100, capped server-side).' })
  @ApiOkResponse({
    description: 'Paginated list of the reporter\'s own tickets.',
    schema: {
      example: {
        total: 3,
        page: 1,
        limit: 20,
        items: [
          TICKET_RESOLVED_EXAMPLE,
          {
            ...TICKET_OPEN_EXAMPLE,
            id: 'b2c3d4e5-1f2a-3b4c-5d6e-7f8a9b0c1d2e',
            ticketNumber: 'TKT-20260628-Q9RZ',
            subject: 'Event venue changed without any notification',
            category: 'EVENT_ISSUE',
            priority: 'NORMAL',
            status: 'OPEN',
            entityType: 'EVENT',
            entityId: 'f6a7b8c9-3d4e-5f6a-7b8c-9d0e1f2a3b4c',
            createdAt: '2026-06-28T09:15:00.000Z',
            updatedAt: '2026-06-28T09:15:00.000Z',
          },
        ],
      },
    },
  })
  listMine(
    @GetUser('id') userId: string,
    @Query('status') status?: SupportTicketStatus,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    return this.supportTicketService.listMine(userId, page, limit, status);
  }

  // ── GET /me/:id ─────────────────────────────────────────────────────────────

  @Get('me/:id')
  @UseGuards(RolesGuard)
  @Roles('USER', 'HOST')
  @ApiForbiddenResponse({ description: 'Insufficient role — must be USER or HOST' })
  @ApiNotFoundResponse({ description: 'Ticket not found or does not belong to the authenticated user' })
  @ApiOperation({
    summary: 'Get detail of one of my support tickets',
    description: `
Returns the full detail of a single ticket, including the admin's \`resolution\` note once the ticket is resolved.

Returns **404** if the ticket does not exist **or** if it belongs to a different user — intentional to prevent probing other users' ticket IDs.
    `,
  })
  @ApiOkResponse({
    description: 'Full ticket detail for the authenticated reporter.',
    schema: { example: TICKET_RESOLVED_EXAMPLE },
  })
  getMyById(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') userId: string,
  ) {
    return this.supportTicketService.getMyById(id, userId);
  }

  // ── GET /admin ──────────────────────────────────────────────────────────────

  @Get('admin')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'CITY_ADMIN', 'SUPPORT', 'MODERATOR')
  @ApiForbiddenResponse({ description: 'Insufficient role' })
  @ApiOperation({
    summary: 'List support tickets with filters (admin)',
    description: `
Returns a paginated list of support tickets. All query parameters are optional and combinable.

**Ordering:** tickets are always sorted by \`priority DESC\` then \`createdAt DESC\`,
so URGENT and HIGH tickets surface first within each page.

**Typical admin workflows:**

| Goal | Filters to apply |
|------|-----------------|
| See all unassigned open tickets | \`status=OPEN\` |
| Review your own queue | \`status=IN_PROGRESS&assignedTo=<your-admin-id>\` |
| Audit a specific category | \`category=REFUND_REQUEST\` |
| Pull high-priority backlog | \`priority=HIGH&status=OPEN\` |
| Date-range report | \`from=2026-07-01&to=2026-07-31\` |
    `,
  })
  @ApiOkResponse({
    description: 'Paginated list of support tickets, ordered by priority then creation date.',
    schema: {
      example: {
        total: 47,
        page: 1,
        limit: 20,
        items: [
          TICKET_OPEN_EXAMPLE,
          {
            ...TICKET_IN_PROGRESS_EXAMPLE,
            id: 'b2c3d4e5-1f2a-3b4c-5d6e-7f8a9b0c1d2e',
            ticketNumber: 'TKT-20260701-M2NP',
            subject: 'Refund for cancelled event – Rooftop Rave 2025',
            category: 'REFUND_REQUEST',
            entityType: 'EVENT',
            entityId: 'b2c3d4e5-1a2b-3c4d-5e6f-7a8b9c0d1e2f',
          },
        ],
      },
    },
  })
  list(@Query() query: ListSupportTicketsQueryDto) {
    return this.supportTicketService.list(query);
  }

  // ── GET /admin/:id ──────────────────────────────────────────────────────────

  @Get('admin/:id')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'CITY_ADMIN', 'SUPPORT', 'MODERATOR')
  @ApiForbiddenResponse({ description: 'Insufficient role' })
  @ApiNotFoundResponse({ description: 'Ticket not found' })
  @ApiOperation({
    summary: 'Get full detail for a single support ticket (admin)',
    description: `
Returns the complete ticket record including the nested \`reporter\`, \`assignee\`, and \`resolver\` profiles.

- **reporter** — always present; the user who filed the ticket (id, firstName, lastName, email).
- **assignee** — present only after the ticket has been assigned via \`POST /admin/:id/assign\`.
- **resolver** — present only after the ticket has been resolved via \`POST /admin/:id/resolve\`.
    `,
  })
  @ApiOkResponse({
    description: 'Full ticket detail.',
    schema: { example: TICKET_IN_PROGRESS_EXAMPLE },
  })
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.supportTicketService.getById(id);
  }

  // ── POST /admin/:id/assign ──────────────────────────────────────────────────

  @Post('admin/:id/assign')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'CITY_ADMIN', 'SUPPORT')
  @ApiForbiddenResponse({ description: 'Insufficient role' })
  @ApiNotFoundResponse({ description: 'Ticket not found' })
  @ApiOperation({
    summary: 'Assign a ticket to an admin user',
    description: `
Assigns the ticket to an admin user and automatically transitions the status to **IN_PROGRESS**.

- The \`adminUserId\` must be a valid user with an admin role — no role check is enforced here, so the caller must ensure this.
- Assigning to a different admin while the ticket is already \`IN_PROGRESS\` is allowed (re-assignment).
- **Cannot assign** a ticket that is already \`RESOLVED\` or \`CLOSED\` — a \`400 Bad Request\` is returned.
    `,
  })
  @ApiBody({
    type: AssignSupportTicketDto,
    examples: {
      assign_to_support_agent: {
        summary: 'Assign to a support agent',
        value: { adminUserId: 'adm1-uuid-0000-0000-000000000001' },
      },
    },
  })
  @ApiOkResponse({
    description: 'Ticket assigned. Status is now IN_PROGRESS and the assignee profile is populated.',
    schema: { example: TICKET_IN_PROGRESS_EXAMPLE },
  })
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') adminId: string,
    @Body() dto: AssignSupportTicketDto,
  ) {
    return this.supportTicketService.assign(id, adminId, dto);
  }

  // ── POST /admin/:id/resolve ─────────────────────────────────────────────────

  @Post('admin/:id/resolve')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'CITY_ADMIN', 'SUPPORT')
  @ApiForbiddenResponse({ description: 'Insufficient role' })
  @ApiNotFoundResponse({ description: 'Ticket not found' })
  @ApiOperation({
    summary: 'Resolve a support ticket with a resolution note',
    description: `
Marks the ticket as **RESOLVED** and records the resolution text, the resolving admin, and the timestamp.

- \`resolution\` is required (10–2000 characters). It should clearly explain what action was taken so the reporter can confirm the outcome.
- After resolving, the ticket can be closed via \`POST /admin/:id/close\`.
- **Cannot resolve** a ticket already in \`RESOLVED\` or \`CLOSED\` state — a \`400 Bad Request\` is returned.

**Good resolution notes include:**
- What the root cause was.
- What action was taken (refund initiated, ticket reissued, account unlocked, etc.).
- Any follow-up the reporter should expect (email confirmation, 3–5 business day SLA, etc.).
    `,
  })
  @ApiBody({
    type: ResolveSupportTicketDto,
    examples: {
      resolve_payment_issue: {
        summary: 'Resolve a payment / ticket-issuance issue',
        value: {
          resolution:
            'We verified the UPI transaction (Ref: UPI20260701XXXX) and confirmed the debit was successful. A fresh event ticket has been issued and emailed to the reporter. If the confirmation email does not arrive within 30 minutes please reply to this ticket.',
        },
      },
      resolve_refund_request: {
        summary: 'Resolve a refund request',
        value: {
          resolution:
            'The cancellation has been verified. A full refund of ₹799 has been initiated to the original payment source. Refunds typically reflect within 5–7 business days depending on the bank. A confirmation email has been sent to the reporter.',
        },
      },
      resolve_account_issue: {
        summary: 'Resolve an account / profile issue',
        value: {
          resolution:
            'The profile photo upload pipeline had a bug affecting users on Android 13 devices. A server-side fix was deployed at 13:00 IST on 2026-07-01. Please retry the upload — it should work now. Apologies for the inconvenience.',
        },
      },
    },
  })
  @ApiOkResponse({
    description: 'Ticket resolved. Status is RESOLVED, resolution text is persisted, resolvedAt and resolver are set.',
    schema: { example: TICKET_RESOLVED_EXAMPLE },
  })
  resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') adminId: string,
    @Body() dto: ResolveSupportTicketDto,
  ) {
    return this.supportTicketService.resolve(id, adminId, dto);
  }

  // ── POST /admin/:id/escalate ────────────────────────────────────────────────

  @Post('admin/:id/escalate')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'CITY_ADMIN', 'SUPPORT')
  @ApiForbiddenResponse({ description: 'Insufficient role' })
  @ApiNotFoundResponse({ description: 'Ticket not found' })
  @ApiOperation({
    summary: 'Change the priority of a support ticket (admin)',
    description: `
Updates the ticket's priority. This is the only way to set **URGENT** — it cannot be set at creation.

- Allowed from any non-CLOSED status.
- Returns \`400\` if the ticket is already at the requested priority.
- Returns \`400\` if the ticket is \`CLOSED\` (terminal state, priority is irrelevant).
- The change is recorded in the audit log with \`from\` and \`to\` values.
    `,
  })
  @ApiBody({
    type: EscalateTicketDto,
    examples: {
      escalate_to_urgent: {
        summary: 'Escalate to URGENT',
        value: { priority: 'URGENT' },
      },
      downgrade_to_normal: {
        summary: 'Downgrade to NORMAL',
        value: { priority: 'NORMAL' },
      },
    },
  })
  @ApiOkResponse({
    description: 'Priority updated. Ticket returned with new priority value.',
    schema: {
      example: {
        ...TICKET_IN_PROGRESS_EXAMPLE,
        priority: 'URGENT',
        updatedAt: '2026-07-01T12:00:00.000Z',
      },
    },
  })
  escalate(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') adminId: string,
    @Body() dto: EscalateTicketDto,
  ) {
    return this.supportTicketService.escalate(id, adminId, dto);
  }

  // ── POST /admin/:id/close ───────────────────────────────────────────────────

  @Post('admin/:id/close')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'CITY_ADMIN', 'SUPPORT')
  @ApiForbiddenResponse({ description: 'Insufficient role' })
  @ApiNotFoundResponse({ description: 'Ticket not found' })
  @ApiOperation({
    summary: 'Close a support ticket',
    description: `
Transitions the ticket to **CLOSED**. No request body is required.

- Closing is a terminal state — a closed ticket **cannot** be reopened or assigned.
- A ticket may be closed from **any** non-CLOSED status (OPEN, IN_PROGRESS, or RESOLVED). Typically admins resolve first, then close after confirming with the reporter.
- If you need to close without a resolution note (e.g. duplicate ticket, spam, reporter retracted), close directly from OPEN or IN_PROGRESS.
- **Cannot close** a ticket already in \`CLOSED\` state — a \`400 Bad Request\` is returned.
    `,
  })
  @ApiOkResponse({
    description: 'Ticket closed. Status is CLOSED — no further state transitions are possible.',
    schema: { example: TICKET_CLOSED_EXAMPLE },
  })
  close(@Param('id', ParseUUIDPipe) id: string, @GetUser('id') adminId: string) {
    return this.supportTicketService.close(id, adminId);
  }
}
