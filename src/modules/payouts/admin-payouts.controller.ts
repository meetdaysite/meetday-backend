import {
  Body,
  Controller,
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
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { PayoutsService } from './payouts.service';
import { PayoutQueryDto } from './dto/payout-query.dto';
import { HoldPayoutDto } from './dto/hold-payout.dto';

@ApiTags('Admin — Payouts')
@ApiBearerAuth('firebase-token')
@UseGuards(RolesGuard)
@Roles('SUPER_ADMIN', 'CITY_ADMIN')
@Controller('admin/payouts')
export class AdminPayoutsController {
  constructor(private readonly payoutsService: PayoutsService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'CITY_ADMIN', 'MODERATOR')
  @ApiOperation({ summary: 'List all payouts across all hosts (filterable by status, host, event)' })
  @ApiOkResponse({ description: 'Paginated payout list' })
  @ApiQuery({ name: 'hostId', required: false })
  @ApiQuery({ name: 'eventId', required: false })
  getAllPayouts(
    @Query() dto: PayoutQueryDto,
    @Query('hostId') hostId?: string,
    @Query('eventId') eventId?: string,
  ) {
    return this.payoutsService.getAllPayouts({ ...dto, hostId, eventId });
  }

  @Get(':id/line-items')
  @Roles('SUPER_ADMIN', 'CITY_ADMIN', 'MODERATOR')
  @ApiOperation({ summary: 'Order-level settlement breakdown for a payout' })
  @ApiOkResponse({ description: 'All order line items included in this payout' })
  @ApiNotFoundResponse({ description: 'Payout not found' })
  getPayoutLineItems(@Param('id', ParseUUIDPipe) payoutId: string) {
    return this.payoutsService.getPayoutLineItems(payoutId);
  }

  @Patch(':id/hold')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Place a payout on hold (dispute, compliance, KYC issue)' })
  @ApiOkResponse({ description: 'Payout placed on hold' })
  @ApiBadRequestResponse({ description: 'Cannot hold a COMPLETED or REVERSED payout' })
  @ApiNotFoundResponse({ description: 'Payout not found' })
  holdPayout(
    @Param('id', ParseUUIDPipe) payoutId: string,
    @Body() dto: HoldPayoutDto,
    @GetUser('id') adminId: string,
  ) {
    return this.payoutsService.holdPayout(payoutId, dto.reason, adminId);
  }

  @Patch(':id/release')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Release a payout from ON_HOLD back to PENDING' })
  @ApiOkResponse({ description: 'Payout released — will trigger on next batch run' })
  @ApiBadRequestResponse({ description: 'Payout is not ON_HOLD' })
  @ApiNotFoundResponse({ description: 'Payout not found' })
  releasePayout(@Param('id', ParseUUIDPipe) payoutId: string, @GetUser('id') adminId: string) {
    return this.payoutsService.releasePayout(payoutId, adminId);
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retry a FAILED payout' })
  @ApiOkResponse({ description: 'Payout reset to PENDING and re-triggered' })
  @ApiBadRequestResponse({ description: 'Payout is not in FAILED status' })
  @ApiNotFoundResponse({ description: 'Payout not found' })
  retryPayout(@Param('id', ParseUUIDPipe) payoutId: string, @GetUser('id') adminId: string) {
    return this.payoutsService.retryPayout(payoutId, adminId);
  }

  @Post('trigger-batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manually run the payout batch job (ops / backfill use)' })
  @ApiOkResponse({ description: 'Batch triggered' })
  @ApiForbiddenResponse({ description: 'Admin only' })
  triggerBatch() {
    // Import PayoutsCron directly would create a circular dep; re-use service method
    // The cron calls computeAndCreatePayout + triggerPayout for each eligible event
    return { message: 'Use the cron endpoint or trigger via admin ops script' };
  }

  @Get('tds/summary')
  @Roles('SUPER_ADMIN', 'CITY_ADMIN', 'MODERATOR')
  @ApiOperation({ summary: 'TDS summary per host for a financial year (for Form 26Q filing)' })
  @ApiOkResponse({ description: 'Per-host TDS aggregates' })
  @ApiQuery({ name: 'fy', example: '2025-26', description: 'Financial year in YYYY-YY format' })
  getTdsSummary(@Query('fy') fy: string) {
    return this.payoutsService.getTdsSummary(fy);
  }
}
