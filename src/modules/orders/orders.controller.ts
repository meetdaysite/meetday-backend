import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { ValidateCouponDto } from './dto/validate-coupon.dto';
import { CancelTicketsDto } from '../refunds/dto/cancel-tickets.dto';

// ─── Shared response shape examples ──────────────────────────────────────────

const ORDER_ITEM_EXAMPLE = {
  id: 'b671f4f1-dc73-4c0a-9bd8-cdfed84b5acb',
  orderId: 'bd9c4962-7d77-4310-a64e-d0c0aa72e2a6',
  ticketId: '9beb6b3f-8b3c-4d2a-85e8-b6ad3e1633ab',
  quantity: 1,
  cancelledCount: 0,
  unitPrice: '1499',
  ticket: { id: '9beb6b3f-8b3c-4d2a-85e8-b6ad3e1633ab', name: 'Masterclass Pass', price: '1499' },
  attendees: [
    {
      id: '76054a82-ebf0-4064-b7a6-316c5fb16041',
      orderItemId: 'b671f4f1-dc73-4c0a-9bd8-cdfed84b5acb',
      fullName: 'Aanya Kapoor',
      email: 'aanya@example.com',
      isLead: true,
      ticketCode: 'c5049409-e7b6-415f-ae8d-dda9fea7daf4',
      checkedInAt: null,
      cancelledAt: null,
      userId: '6d01f554-2d4a-41c0-8060-368e510ad0bd',
    },
  ],
};

const ORDER_EXAMPLE = {
  id: 'bd9c4962-7d77-4310-a64e-d0c0aa72e2a6',
  bookingId: 'MDAY-48FE-024C',
  userId: '6d01f554-2d4a-41c0-8060-368e510ad0bd',
  eventId: '7524db57-fcdd-40a9-91e9-d8effd537384',
  status: 'PENDING_PAYMENT',
  subtotal: '1499',
  discountAmount: '149.9',
  netSubtotal: '1349.1',
  platformFee: '269.82',
  taxAmount: '291.41',
  totalAmount: '1910.33',
  couponId: 'f9557a75-334d-47d4-aa28-3b092b2bd9cc',
  hostFeePromoId: null,
  razorpayOrderId: null,
  razorpayPaymentId: null,
  confirmedAt: null,
  cancelledAt: null,
  cancellationReason: null,
  createdAt: '2026-07-01T19:27:32.828Z',
  updatedAt: '2026-07-01T19:27:32.828Z',
  items: [ORDER_ITEM_EXAMPLE],
};

const ERROR_401 = { statusCode: 401, message: 'Unauthorized' };
const ERROR_403_OWN = { statusCode: 403, message: 'You do not own this order', error: 'Forbidden' };
const ERROR_403_PERM = { statusCode: 403, message: 'You do not have permission to access this resource.', error: 'Forbidden' };
const ERROR_404_ORDER = { statusCode: 404, message: 'Order not found', error: 'Not Found' };

// ─────────────────────────────────────────────────────────────────────────────

@ApiTags('Orders')
@ApiBearerAuth('firebase-token')
@UseGuards(RolesGuard)
@Roles('USER')
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  // ── POST /orders ────────────────────────────────────────────────────────────

  @Post()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an order',
    description: `
Places a ticket order for an event. The operation is atomic:
- Reserves seat capacity (fails immediately if sold out)
- Validates ticket sale windows and per-person limits
- Applies and locks the promo code if \`couponCode\` is provided
- Snapshots all financial figures at creation time (never recomputed)

The order is returned in **PENDING_PAYMENT** status.

**Financial breakdown when a coupon is used:**
\`\`\`
subtotal      gross ticket price (all items)
discountAmount coupon discount
netSubtotal   subtotal − discountAmount  ← platform fee & GST are based on this
platformFee   netSubtotal × host plan fee rate
taxAmount     (netSubtotal + platformFee) × GST rate
totalAmount   netSubtotal + platformFee + taxAmount
\`\`\`

**Next step:** call \`POST /payments/initiate\` to generate a Razorpay order, or \`POST /orders/:id/confirm-free\` if \`totalAmount === 0\`.

Rate-limited to **10 requests per minute** per user.
    `.trim(),
  })
  @ApiBody({
    description: 'Order payload. `couponCode` is optional; omit it for orders without a promo.',
    schema: {
      examples: {
        single_ticket: {
          summary: 'Single ticket, no coupon',
          value: {
            eventId: '7524db57-fcdd-40a9-91e9-d8effd537384',
            items: [
              { ticketId: '9beb6b3f-8b3c-4d2a-85e8-b6ad3e1633ab', quantity: 1 },
            ],
          },
        },
        with_coupon: {
          summary: 'Single ticket with promo code',
          value: {
            eventId: '7524db57-fcdd-40a9-91e9-d8effd537384',
            items: [
              { ticketId: '9beb6b3f-8b3c-4d2a-85e8-b6ad3e1633ab', quantity: 1 },
            ],
            couponCode: 'EARLYBIRD10',
          },
        },
        group_booking: {
          summary: 'Two tickets with additional attendee details',
          value: {
            eventId: '7524db57-fcdd-40a9-91e9-d8effd537384',
            items: [
              {
                ticketId: '9beb6b3f-8b3c-4d2a-85e8-b6ad3e1633ab',
                quantity: 2,
                groupAttendees: [
                  { fullName: 'Rahul Sharma', email: 'rahul@example.com' },
                ],
              },
            ],
          },
        },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'Order created in PENDING_PAYMENT status. All financial fields are snapshotted and will not change.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-07-01T19:27:34.194Z',
        data: ORDER_EXAMPLE,
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'One of several validation failures.',
    schema: {
      examples: {
        coupon_invalid: {
          summary: 'Promo code is invalid or inactive',
          value: { statusCode: 400, message: 'Invalid or inactive promo code', error: 'Bad Request' },
        },
        coupon_expired: {
          summary: 'Promo code has expired',
          value: { statusCode: 400, message: 'Promo code has expired', error: 'Bad Request' },
        },
        coupon_wrong_event: {
          summary: 'Promo code is not valid for this event',
          value: { statusCode: 400, message: 'Promo code is not valid for this event', error: 'Bad Request' },
        },
        min_order_value: {
          summary: 'Basket does not meet coupon minimum',
          value: { statusCode: 400, message: 'A minimum order value of ₹500 is required to use this promo code', error: 'Bad Request' },
        },
        sale_not_started: {
          summary: 'Ticket sales not yet open',
          value: { statusCode: 400, message: 'Ticket "Early Bird" sales have not started yet', error: 'Bad Request' },
        },
        sale_ended: {
          summary: 'Ticket sales have closed',
          value: { statusCode: 400, message: 'Ticket "Early Bird" sales have ended', error: 'Bad Request' },
        },
        max_per_person: {
          summary: 'Per-person ticket limit exceeded',
          value: { statusCode: 400, message: 'You already have 2 ticket(s) for "Early Bird". Maximum allowed: 2', error: 'Bad Request' },
        },
        group_attendee_mismatch: {
          summary: 'groupAttendees count does not match quantity − 1',
          value: { statusCode: 400, message: 'Provide attendee details for each additional ticket for "General Admission" (need 1, got 0)', error: 'Bad Request' },
        },
      },
    },
  })
  @ApiConflictResponse({
    description: 'Race condition: capacity filled up or promo code exhausted between validation and commit.',
    schema: {
      examples: {
        sold_out: {
          summary: 'Ticket tier sold out',
          value: { statusCode: 409, message: 'Not enough tickets available for "General Admission"', available: 0, requested: 2 },
        },
        coupon_race: {
          summary: 'Promo code usage limit reached (concurrent order)',
          value: { statusCode: 409, message: 'Promo code usage limit reached', error: 'Conflict' },
        },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Event or one of the requested ticket tiers not found.',
    schema: {
      examples: {
        event: { summary: 'Event not found', value: { statusCode: 404, message: 'Event not found', error: 'Not Found' } },
        ticket: { summary: 'Ticket not found', value: { statusCode: 404, message: 'One or more tickets not found for this event', error: 'Not Found' } },
      },
    },
  })
  @ApiUnauthorizedResponse({ schema: { example: ERROR_401 } })
  @ApiForbiddenResponse({ schema: { example: ERROR_403_PERM } })
  createOrder(
    @GetUser('id') userId: string,
    @Body() dto: CreateOrderDto,
  ) {
    return this.ordersService.createOrder(userId, dto);
  }

  // ── POST /orders/validate-coupon ────────────────────────────────────────────

  @Post('validate-coupon')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Preview coupon discount',
    description: `
Validates a promo code against a basket (event + ticket items) and returns the computed discount **without creating an order**.

Use this to show the attendee their savings before they confirm checkout. The response includes \`netSubtotal\` — the discounted subtotal on which platform fee and GST are later calculated — so the frontend can render a complete pre-checkout breakdown.

This endpoint performs all the same coupon checks as \`POST /orders\` (active, target, date window, per-user limit, min order value) but does **not** lock any capacity or increment usage counts.
    `.trim(),
  })
  @ApiBody({
    description: 'Basket to validate the coupon against.',
    schema: {
      example: {
        eventId: '7524db57-fcdd-40a9-91e9-d8effd537384',
        couponCode: 'EARLYBIRD10',
        items: [
          { ticketId: '9beb6b3f-8b3c-4d2a-85e8-b6ad3e1633ab', quantity: 1 },
        ],
      },
    },
  })
  @ApiOkResponse({
    description: 'Coupon is valid. Returns the discount breakdown for display in the checkout UI.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-07-01T19:00:00.000Z',
        data: {
          valid: true,
          couponCode: 'EARLYBIRD10',
          discountType: 'PERCENTAGE',
          discountValue: 10,
          subtotal: 1499,
          discountAmount: 149.9,
          netSubtotal: 1349.1,
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Coupon is invalid, expired, or cannot be applied to this basket.',
    schema: {
      examples: {
        invalid: {
          summary: 'Not found or inactive',
          value: { statusCode: 400, message: 'Invalid or inactive promo code', error: 'Bad Request' },
        },
        expired: {
          summary: 'Past validUntil date',
          value: { statusCode: 400, message: 'Promo code has expired', error: 'Bad Request' },
        },
        not_yet_active: {
          summary: 'Before validFrom date',
          value: { statusCode: 400, message: 'Promo code is not yet active', error: 'Bad Request' },
        },
        wrong_event: {
          summary: 'Code is scoped to a different event',
          value: { statusCode: 400, message: 'Promo code is not valid for this event', error: 'Bad Request' },
        },
        usage_limit: {
          summary: 'Global usage cap reached',
          value: { statusCode: 400, message: 'Promo code usage limit reached', error: 'Bad Request' },
        },
        per_user_limit: {
          summary: 'Caller already used this code the maximum number of times',
          value: { statusCode: 400, message: 'You have already used this promo code the maximum number of times', error: 'Bad Request' },
        },
        min_order: {
          summary: 'Basket subtotal below coupon minimum',
          value: { statusCode: 400, message: 'A minimum order value of ₹500 is required to use this promo code', error: 'Bad Request' },
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ schema: { example: ERROR_401 } })
  validateCoupon(
    @GetUser('id') userId: string,
    @Body() dto: ValidateCouponDto,
  ) {
    return this.ordersService.validateCoupon(userId, dto);
  }

  // ── POST /orders/:id/mock-confirm ───────────────────────────────────────────

  @Post(':id/mock-confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[DEV ONLY] Confirm an order without payment',
    description:
      'Immediately moves a PENDING_PAYMENT order to CONFIRMED. ' +
      'Disabled in production (`NODE_ENV=production`). Use this while Razorpay integration is pending.',
  })
  @ApiParam({ name: 'id', description: 'UUID of the order to confirm.', example: 'bd9c4962-7d77-4310-a64e-d0c0aa72e2a6' })
  @ApiOkResponse({ schema: { example: { success: true, timestamp: '2026-07-01T19:30:00.000Z', data: { message: 'Order confirmed' } } } })
  @ApiBadRequestResponse({
    schema: {
      examples: {
        wrong_status: {
          summary: 'Order is not in PENDING_PAYMENT',
          value: { statusCode: 400, message: 'Order is already confirmed', error: 'Bad Request' },
        },
      },
    },
  })
  @ApiForbiddenResponse({
    schema: {
      examples: {
        production: { summary: 'Endpoint disabled in production', value: { statusCode: 403, message: 'Mock confirm is not available in production', error: 'Forbidden' } },
        not_owner: { summary: 'Order belongs to a different user', value: ERROR_403_OWN },
      },
    },
  })
  @ApiNotFoundResponse({ schema: { example: ERROR_404_ORDER } })
  @ApiUnauthorizedResponse({ schema: { example: ERROR_401 } })
  mockConfirm(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') userId: string,
  ) {
    return this.ordersService.mockConfirm(id, userId);
  }

  // ── POST /orders/:id/confirm-free ───────────────────────────────────────────

  @Post(':id/confirm-free')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm a free (zero-amount) order',
    description: `
Confirms a \`PENDING_PAYMENT\` order whose \`totalAmount\` is exactly **₹0**.

Use this endpoint when **all tickets in the order are free** (\`isFree: true\`). It bypasses Razorpay entirely and immediately transitions the order to \`CONFIRMED\`.

**When to call this vs the payment flow:**
- \`totalAmount === 0\` → call this endpoint
- \`totalAmount > 0\`  → call \`POST /payments/initiate\` instead

**Side effects on success** (same as a paid order confirmation):
- Order status set to \`CONFIRMED\`
- Ticket confirmation email queued for the buyer
- In-app notification sent to the buyer
- In-app notification sent to the host
- Crowd pulse recomputed for the event
- Community member event count updated
- Audit log entry created
    `.trim(),
  })
  @ApiParam({ name: 'id', description: 'UUID of the order to confirm.', example: 'bd9c4962-7d77-4310-a64e-d0c0aa72e2a6' })
  @ApiOkResponse({
    description: 'Order confirmed successfully.',
    schema: { example: { success: true, timestamp: '2026-07-01T19:30:00.000Z', data: { message: 'Order confirmed' } } },
  })
  @ApiBadRequestResponse({
    description: 'Order cannot be confirmed.',
    schema: {
      examples: {
        not_free: {
          summary: 'Order has a non-zero total',
          value: { statusCode: 400, message: 'This order requires payment — use POST /payments/initiate', error: 'Bad Request' },
        },
        wrong_status: {
          summary: 'Order is not in PENDING_PAYMENT',
          value: { statusCode: 400, message: 'Order is already confirmed', error: 'Bad Request' },
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ schema: { example: ERROR_401 } })
  @ApiForbiddenResponse({
    schema: {
      examples: {
        not_owner: { summary: 'Order belongs to a different user', value: ERROR_403_OWN },
      },
    },
  })
  @ApiNotFoundResponse({ schema: { example: ERROR_404_ORDER } })
  confirmFreeOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') userId: string,
  ) {
    return this.ordersService.confirmFreeOrder(id, userId);
  }

  // ── GET /orders/me ──────────────────────────────────────────────────────────

  @Get('me')
  @ApiOperation({
    summary: 'List my orders',
    description: 'Returns the authenticated user\'s orders, newest first. Paginated. Each item includes event summary, ticket line items, and financial snapshot (including `netSubtotal`).',
  })
  @ApiQuery({ name: 'page', required: false, example: 1, description: 'Page number (1-based, default 1).' })
  @ApiQuery({ name: 'limit', required: false, example: 20, description: 'Items per page (default 20).' })
  @ApiOkResponse({
    description: 'Paginated list of the caller\'s orders.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-07-01T20:00:00.000Z',
        data: {
          orders: [
            {
              id: 'bd9c4962-7d77-4310-a64e-d0c0aa72e2a6',
              status: 'CONFIRMED',
              subtotal: '1499',
              discountAmount: '149.9',
              netSubtotal: '1349.1',
              platformFee: '269.82',
              taxAmount: '291.41',
              totalAmount: '1910.33',
              confirmedAt: '2026-07-01T19:30:00.000Z',
              cancelledAt: null,
              createdAt: '2026-07-01T19:27:32.828Z',
              event: {
                id: '7524db57-fcdd-40a9-91e9-d8effd537384',
                title: 'Product Design Masterclass',
                eventDate: '2026-08-15T00:00:00.000Z',
                startTime: '10:00',
                venueName: 'Design Hub',
                city: 'Bangalore',
              },
              items: [
                {
                  id: 'b671f4f1-dc73-4c0a-9bd8-cdfed84b5acb',
                  quantity: 1,
                  unitPrice: '1499',
                  ticket: { id: '9beb6b3f-8b3c-4d2a-85e8-b6ad3e1633ab', name: 'Masterclass Pass' },
                  _count: { attendees: 1 },
                },
              ],
            },
          ],
          total: 1,
          page: 1,
          limit: 20,
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ schema: { example: ERROR_401 } })
  getMyOrders(
    @GetUser('id') userId: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    return this.ordersService.getMyOrders(userId, page, limit);
  }

  // ── GET /orders/:id ─────────────────────────────────────────────────────────

  @Get(':id')
  @ApiOperation({
    summary: 'Get order detail',
    description: 'Returns full order detail including event info, coupon applied, all ticket line items, and per-attendee QR ticket codes (`ticketCode`).',
  })
  @ApiParam({ name: 'id', description: 'UUID of the order.', example: 'bd9c4962-7d77-4310-a64e-d0c0aa72e2a6' })
  @ApiOkResponse({
    description: 'Full order detail.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-07-01T20:00:00.000Z',
        data: {
          ...ORDER_EXAMPLE,
          event: {
            id: '7524db57-fcdd-40a9-91e9-d8effd537384',
            title: 'Product Design Masterclass',
            eventDate: '2026-08-15T00:00:00.000Z',
            startTime: '10:00',
            endTime: '13:00',
            venueName: 'Design Hub',
            fullAddress: '123 Design Street, Indiranagar',
            city: 'Bangalore',
          },
          coupon: {
            code: 'EARLYBIRD10',
            discountType: 'PERCENTAGE',
            discountValue: 10,
          },
        },
      },
    },
  })
  @ApiNotFoundResponse({ schema: { example: ERROR_404_ORDER } })
  @ApiForbiddenResponse({ schema: { example: ERROR_403_OWN } })
  @ApiUnauthorizedResponse({ schema: { example: ERROR_401 } })
  getOrderById(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') userId: string,
  ) {
    return this.ordersService.getOrderById(id, userId);
  }

  // ── POST /orders/:id/cancel-tickets ─────────────────────────────────────────

  @Post(':id/cancel-tickets')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel specific tickets on a confirmed order',
    description:
      'Cancels one or more individual ticket slots within a CONFIRMED or PARTIALLY_REFUNDED order. ' +
      'Pass the exact OrderItem IDs, quantities, and attendee IDs to cancel. ' +
      'Validates the event refund window and blocks cancellation for already checked-in attendees. ' +
      'A refund is automatically initiated to the original payment method per the event refund policy. ' +
      'If all tickets are cancelled the order transitions to CANCELLED; otherwise to PARTIALLY_REFUNDED.',
  })
  @ApiParam({ name: 'id', description: 'UUID of the order.', example: 'bd9c4962-7d77-4310-a64e-d0c0aa72e2a6' })
  @ApiBody({
    description: 'List of OrderItem slots to cancel.',
    schema: {
      example: {
        items: [
          {
            orderItemId: 'b671f4f1-dc73-4c0a-9bd8-cdfed84b5acb',
            quantity: 1,
            attendeeIds: ['76054a82-ebf0-4064-b7a6-316c5fb16041'],
          },
        ],
      },
    },
  })
  @ApiOkResponse({
    description: 'Cancellation initiated.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-07-01T20:05:00.000Z',
        data: {
          message: 'Cancellation initiated',
          refundId: 'e2f3a4b5-c6d7-8901-e2f3-a4b5c6d78901',
          refundAmountPaise: 191033,
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Cancellation not allowed.',
    schema: {
      examples: {
        window_passed: {
          summary: 'Outside refund window',
          value: { statusCode: 400, message: 'Cancellation window has passed', error: 'Bad Request' },
        },
        checked_in: {
          summary: 'Attendee already checked in',
          value: { statusCode: 400, message: 'Attendee has already checked in and cannot be cancelled', error: 'Bad Request' },
        },
        wrong_status: {
          summary: 'Order is not CONFIRMED or PARTIALLY_REFUNDED',
          value: { statusCode: 400, message: 'Only confirmed orders can have tickets cancelled', error: 'Bad Request' },
        },
      },
    },
  })
  @ApiNotFoundResponse({ schema: { example: ERROR_404_ORDER } })
  @ApiForbiddenResponse({ schema: { example: ERROR_403_OWN } })
  @ApiUnauthorizedResponse({ schema: { example: ERROR_401 } })
  cancelTickets(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') userId: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true })) dto: CancelTicketsDto,
  ) {
    return this.ordersService.cancelTickets(id, userId, dto);
  }

  // ── POST /orders/:id/cancel ──────────────────────────────────────────────────

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel all remaining tickets on a confirmed order',
    description:
      'Convenience endpoint that cancels every active ticket in a CONFIRMED or PARTIALLY_REFUNDED order at once. ' +
      'Equivalent to calling POST /orders/:id/cancel-tickets with all active OrderItem IDs. ' +
      'Blocked if any attendee has already checked in.',
  })
  @ApiParam({ name: 'id', description: 'UUID of the order.', example: 'bd9c4962-7d77-4310-a64e-d0c0aa72e2a6' })
  @ApiOkResponse({
    description: 'Cancellation initiated.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-07-01T20:05:00.000Z',
        data: {
          message: 'Cancellation initiated',
          refundId: 'e2f3a4b5-c6d7-8901-e2f3-a4b5c6d78901',
          refundAmountPaise: 191033,
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Order is not cancellable.',
    schema: {
      examples: {
        wrong_status: {
          summary: 'Order is not CONFIRMED or PARTIALLY_REFUNDED',
          value: { statusCode: 400, message: 'Only confirmed orders can be cancelled', error: 'Bad Request' },
        },
        checked_in: {
          summary: 'An attendee has already checked in',
          value: { statusCode: 400, message: 'Attendee has already checked in and cannot be cancelled', error: 'Bad Request' },
        },
        no_active_tickets: {
          summary: 'No active tickets remaining',
          value: { statusCode: 400, message: 'No active tickets remaining on this order', error: 'Bad Request' },
        },
      },
    },
  })
  @ApiNotFoundResponse({ schema: { example: ERROR_404_ORDER } })
  @ApiForbiddenResponse({ schema: { example: ERROR_403_OWN } })
  @ApiUnauthorizedResponse({ schema: { example: ERROR_401 } })
  cancelOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') userId: string,
  ) {
    return this.ordersService.cancelOrder(id, userId);
  }
}
