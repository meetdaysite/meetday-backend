import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { BrandsService } from './brands.service';

@ApiTags('Brands')
@ApiBearerAuth('firebase-token')
@UseGuards(RolesGuard)
@Roles('BRAND')
@Controller('brands')
export class BrandsController {
  constructor(private readonly brandsService: BrandsService) {}

  @Get('me')
  @ApiOperation({ summary: "Get the authenticated brand's own profile" })
  @ApiOkResponse({ description: 'Brand profile.' })
  getMe(@GetUser('id') userId: string) {
    return this.brandsService.getMe(userId);
  }
}
