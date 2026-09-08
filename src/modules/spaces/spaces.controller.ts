import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { SpacesService } from './spaces.service';
import { UpdateSpaceProfileDto } from './dto/update-space-profile.dto';

@ApiTags('Spaces')
@ApiBearerAuth('firebase-token')
@UseGuards(RolesGuard)
@Roles('SPACE_PARTNER')
@Controller('spaces')
export class SpacesController {
  constructor(private readonly spacesService: SpacesService) {}

  @Get('me')
  @ApiOperation({ summary: "Get the authenticated space partner's own profile" })
  @ApiOkResponse({ description: 'Space partner profile.' })
  getMe(@GetUser('id') userId: string) {
    return this.spacesService.getMe(userId);
  }

  @Patch('me')
  @ApiOperation({ summary: "Update the authenticated space partner's profile" })
  @ApiOkResponse({ description: 'Updated space partner profile.' })
  updateMe(@GetUser('id') userId: string, @Body() dto: UpdateSpaceProfileDto) {
    return this.spacesService.updateProfile(userId, dto);
  }
}
