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
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';

@ApiTags('Orders')
@ApiBearerAuth('firebase-token')
@UseGuards(RolesGuard)
@Roles('USER')
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an order',
    description:
      'Places a ticket order for an event. Atomically reserves capacity, validates sale windows, ' +
      'enforces per-person limits, and applies a promo code if provided. ' +
      'Returns the order in PENDING_PAYMENT status. ' +
      'Call POST /orders/:id/mock-confirm (dev) to confirm without payment.',
  })
  @ApiCreatedResponse({ description: 'Order created in PENDING_PAYMENT status.' })
  @ApiBadRequestResponse({ description: 'Validation error (sale window, maxPerPerson, group attendees, coupon).' })
  @ApiConflictResponse({ description: 'Not enough tickets available for one of the tiers.' })
  @ApiNotFoundResponse({ description: 'Event or ticket not found.' })
  createOrder(
    @GetUser('id') userId: string,
    @Body() dto: CreateOrderDto,
  ) {
    return this.ordersService.createOrder(userId, dto);
  }

  @Post(':id/mock-confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[DEV ONLY] Confirm an order without payment',
    description:
      'Immediately moves a PENDING_PAYMENT order to CONFIRMED. ' +
      'Disabled in production. Use this while Razorpay integration is pending.',
  })
  @ApiOkResponse({ description: 'Order confirmed.' })
  @ApiBadRequestResponse({ description: 'Order is not in PENDING_PAYMENT status.' })
  @ApiForbiddenResponse({ description: 'Not available in production, or order belongs to a different user.' })
  @ApiNotFoundResponse({ description: 'Order not found.' })
  mockConfirm(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') userId: string,
  ) {
    return this.ordersService.mockConfirm(id, userId);
  }

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
  @ApiParam({
    name: 'id',
    description: 'UUID of the order to confirm.',
    example: 'a3f1c2e4-5b67-4d89-9f01-234567890abc',
  })
  @ApiOkResponse({
    description: 'Order confirmed successfully.',
    schema: {
      example: { message: 'Order confirmed' },
    },
  })
  @ApiBadRequestResponse({
    description: 'Order cannot be confirmed for one of the following reasons.',
    schema: {
      examples: {
        not_free: {
          summary: 'Order has a non-zero total',
          value: {
            statusCode: 400,
            message: 'This order requires payment — use POST /payments/initiate',
            error: 'Bad Request',
          },
        },
        wrong_status: {
          summary: 'Order is not in PENDING_PAYMENT',
          value: {
            statusCode: 400,
            message: 'Order is already confirmed',
            error: 'Bad Request',
          },
        },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid Firebase token.',
    schema: {
      example: {
        statusCode: 401,
        message: 'Unauthorized',
      },
    },
  })
  @ApiForbiddenResponse({
    description: 'Authenticated user does not own this order.',
    schema: {
      example: {
        statusCode: 403,
        message: 'You do not own this order',
        error: 'Forbidden',
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'No order found with the given ID.',
    schema: {
      example: {
        statusCode: 404,
        message: 'Order not found',
        error: 'Not Found',
      },
    },
  })
  confirmFreeOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') userId: string,
  ) {
    return this.ordersService.confirmFreeOrder(id, userId);
  }

  @Get('me')
  @ApiOperation({
    summary: 'List my orders',
    description: 'Returns the authenticated user\'s orders, newest first. Paginated.',
  })
  @ApiOkResponse({ description: 'Paginated list of orders.' })
  getMyOrders(
    @GetUser('id') userId: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    return this.ordersService.getMyOrders(userId, page, limit);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get order detail',
    description: 'Returns full order detail including attendees and QR ticket codes.',
  })
  @ApiOkResponse({ description: 'Order detail with attendees.' })
  @ApiNotFoundResponse({ description: 'Order not found.' })
  @ApiForbiddenResponse({ description: 'Order belongs to a different user.' })
  getOrderById(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') userId: string,
  ) {
    return this.ordersService.getOrderById(id, userId);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a confirmed order',
    description:
      'Cancels a CONFIRMED order and releases ticket capacity. ' +
      'Validates the refund window defined on the event. ' +
      'Actual refund processing is handled when Razorpay is wired in.',
  })
  @ApiOkResponse({ description: 'Order cancelled.' })
  @ApiBadRequestResponse({ description: 'Order is not CONFIRMED, or cancellation window has passed.' })
  @ApiNotFoundResponse({ description: 'Order not found.' })
  @ApiForbiddenResponse({ description: 'Order belongs to a different user.' })
  cancelOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') userId: string,
  ) {
    return this.ordersService.cancelOrder(id, userId);
  }
}
