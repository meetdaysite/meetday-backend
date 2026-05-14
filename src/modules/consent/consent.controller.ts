import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ConsentType } from '@prisma/client';
import { Request } from 'express';
import { ConsentService } from './consent.service';
import { GrantConsentDto } from './dto/grant-consent.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GetUser } from '../../common/decorators/get-user.decorator';

@ApiTags('Consent')
@ApiBearerAuth('firebase-token')
@ApiUnauthorizedResponse({ description: 'Missing or invalid Firebase JWT' })
@Controller('consent')
export class ConsentController {
  constructor(private readonly consentService: ConsentService) {}

  @Post()
  @ApiOperation({ summary: 'Record a consent grant for the authenticated user' })
  @ApiOkResponse({ description: 'Consent recorded' })
  grantConsent(
    @GetUser('id') userId: string,
    @Body() dto: GrantConsentDto,
    @Req() req: Request,
  ) {
    return this.consentService.grantConsent({
      userId,
      consentType: dto.consentType,
      version: dto.version,
      consentText: dto.consentText,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete(':type')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Withdraw a consent type for the authenticated user' })
  @ApiNoContentResponse({ description: 'Consent withdrawn' })
  @ApiNotFoundResponse({ description: 'No active consent found for this type' })
  @ApiParam({ name: 'type', enum: ConsentType })
  withdrawConsent(
    @GetUser('id') userId: string,
    @Param('type', new ParseEnumPipe(ConsentType)) consentType: ConsentType,
  ) {
    return this.consentService.withdrawConsent(userId, consentType);
  }

  // ── Admin routes ──────────────────────────────────────────────────────────

  @Get('admin/:userId')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'CITY_ADMIN', 'SUPPORT')
  @ApiOperation({ summary: 'Admin: view full consent history for a user' })
  @ApiOkResponse({ description: 'Consent history' })
  @ApiParam({ name: 'userId', type: String })
  getUserConsentHistory(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.consentService.getUserConsentHistory(userId);
  }
}
