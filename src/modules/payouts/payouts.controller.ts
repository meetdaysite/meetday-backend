import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  RawBody,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { PayoutsService } from './payouts.service';
import { PayoutQueryDto } from './dto/payout-query.dto';
import { PayoutWebhookDto } from './dto/payout-webhook.dto';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('Payouts')
@Controller()
export class PayoutsController {
  constructor(
    private readonly payoutsService: PayoutsService,
    private readonly prisma: PrismaService,
  ) {}

  // ─── Host-facing endpoints ─────────────────────────────────────────────────

  @Get('host/payouts')
  @ApiBearerAuth('firebase-token')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @ApiOperation({ summary: 'List all payouts for the authenticated host' })
  @ApiOkResponse({ description: 'Paginated payout list' })
  @ApiForbiddenResponse({ description: 'Not a verified host' })
  async getMyPayouts(@GetUser('id') userId: string, @Query() dto: PayoutQueryDto) {
    const host = await this.resolveHostProfile(userId);
    return this.payoutsService.getHostPayouts(host.id, dto);
  }

  @Get('host/payouts/:id')
  @ApiBearerAuth('firebase-token')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @ApiOperation({ summary: 'Get payout detail with order line items' })
  @ApiOkResponse({ description: 'Payout detail including all order line items and status history' })
  @ApiNotFoundResponse({ description: 'Payout not found' })
  async getMyPayoutById(@GetUser('id') userId: string, @Param('id', ParseUUIDPipe) payoutId: string) {
    const host = await this.resolveHostProfile(userId);
    return this.payoutsService.getHostPayoutById(payoutId, host.id);
  }

  @Get('host/earnings')
  @ApiBearerAuth('firebase-token')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @ApiOperation({ summary: 'Earnings summary — total paid out, pending, TDS deducted' })
  @ApiOkResponse({ description: 'Aggregated earnings stats' })
  async getMyEarnings(@GetUser('id') userId: string) {
    const host = await this.resolveHostProfile(userId);
    return this.payoutsService.getHostEarnings(host.id);
  }

  @Get('host/earnings/events')
  @ApiBearerAuth('firebase-token')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @ApiOperation({ summary: 'Per-event earnings breakdown' })
  @ApiOkResponse({ description: 'List of payouts grouped by event' })
  async getMyEarningsByEvent(@GetUser('id') userId: string) {
    const host = await this.resolveHostProfile(userId);
    return this.payoutsService.getHostEarningsByEvent(host.id);
  }

  // ─── Razorpay payout webhook (public, no auth) ─────────────────────────────

  @Post('payouts/webhook')
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Razorpay payout status webhook — do not call manually' })
  @ApiUnauthorizedResponse({ description: 'Invalid webhook signature' })
  handlePayoutWebhook(
    @Body() dto: PayoutWebhookDto,
    @RawBody() rawBody: Buffer,
    @Headers('x-razorpay-signature') signature: string,
  ) {
    this.payoutsService.handlePayoutWebhook(rawBody, signature, dto);
    return { status: 'ok' };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async resolveHostProfile(userId: string) {
    const host = await this.prisma.hostProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!host) throw new Error('Host profile not found for user');
    return host;
  }
}
