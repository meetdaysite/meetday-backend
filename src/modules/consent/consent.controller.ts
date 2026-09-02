import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ConsentService } from './consent.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('Consent')
@ApiBearerAuth('firebase-token')
@ApiUnauthorizedResponse({ description: 'Missing or invalid Firebase JWT' })
@Controller('consent')
export class ConsentController {
  constructor(private readonly consentService: ConsentService) {}

  @Get('admin/:userId')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'CITY_ADMIN', 'SUPPORT', 'MODERATOR')
  @ApiOperation({ summary: 'Admin: view full consent history for a user' })
  @ApiOkResponse({ description: 'Consent history' })
  @ApiParam({ name: 'userId', type: String })
  getUserConsentHistory(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.consentService.getUserConsentHistory(userId);
  }
}
