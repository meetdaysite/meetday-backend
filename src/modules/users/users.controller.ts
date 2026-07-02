import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { UsersService } from './users.service';
import { DeleteAccountDto } from './dto/delete-account.dto';

@ApiTags('Users')
@ApiBearerAuth('firebase-token')
@ApiUnauthorizedResponse({ description: 'Missing or invalid Firebase JWT' })
@UseGuards(RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Delete('me')
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @HttpCode(HttpStatus.OK)
  @Roles('USER', 'HOST')
  @ApiOperation({
    summary: 'Delete own account',
    description:
      'Permanently deletes the authenticated user\'s account in compliance with the Digital Personal Data Protection Act (DPDP), 2023.\n\n' +
      '**What happens:**\n' +
      '- Personal data (name, email, phone, avatar) is anonymised immediately\n' +
      '- All consent records are withdrawn\n' +
      '- The Firebase account is disabled so existing tokens stop working\n' +
      '- The deletion is recorded in the audit log\n\n' +
      '**Retained data (legal hold):**\n' +
      'Financial records (orders, payments, refunds, payouts, invoices) are retained as required by the RBI, GST Act, and Income Tax Act (up to 8 years).\n\n' +
      '**Blockers — the request will be rejected (400) if:**\n' +
      '- You have confirmed bookings for upcoming events (cancel tickets first)\n' +
      '- _(Host only)_ You have upcoming published events (cancel all events first)\n' +
      '- _(Host only)_ You have payouts in PENDING or PROCESSING state (wait for settlement)',
  })
  @ApiBody({ type: DeleteAccountDto, required: false })
  @ApiOkResponse({
    description: 'Account deleted and PII anonymised',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example:
            'Your account has been deleted and all personal data has been removed. Financial records are retained as required by applicable law.',
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'One or more blockers prevent deletion',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 400 },
        message: {
          type: 'array',
          items: { type: 'string' },
          example: [
            'You have confirmed bookings for upcoming events. Cancel your tickets first via the orders section.',
            'You have upcoming published events. Cancel all active events before deleting your account.',
          ],
        },
        error: { type: 'string', example: 'Bad Request' },
      },
    },
  })
  @ApiForbiddenResponse({ description: 'Endpoint is not available to admin accounts' })
  deleteSelfAccount(
    @GetUser('id') userId: string,
    @GetUser('uid') firebaseUid: string,
    @GetUser('role') role: string,
    @Body() dto: DeleteAccountDto,
    @Req() req: Request,
  ) {
    return this.usersService.deleteSelfAccount(
      userId,
      firebaseUid,
      role,
      dto,
      req.ip,
      req.headers['user-agent'],
    );
  }
}
