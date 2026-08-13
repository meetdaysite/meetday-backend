import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { BrandsService } from './brands.service';
import { UpdateBrandProfileDto } from './dto/update-brand-profile.dto';

@ApiTags('Brands')
@ApiBearerAuth('firebase-token')
@UseGuards(RolesGuard)
@Roles('BRAND')
@Controller('brands')
export class BrandsController {
  constructor(private readonly brandsService: BrandsService) {}

  @Get('me')
  @ApiOperation({ summary: "Get the authenticated brand's own profile" })
  @ApiOkResponse({ description: 'Brand profile, including `isProfileComplete`.' })
  getMe(@GetUser('id') userId: string) {
    return this.brandsService.getMe(userId);
  }

  @Patch('me')
  @ApiOperation({
    summary: "Update the authenticated brand's profile",
    description:
      'All fields optional/skippable. Categories and social links must all be filled in for ' +
      '`isProfileComplete` to become true, which is required to mark interest in a proposal.',
  })
  @ApiOkResponse({ description: 'Updated brand profile.' })
  updateMe(@GetUser('id') userId: string, @Body() dto: UpdateBrandProfileDto) {
    return this.brandsService.updateProfile(userId, dto);
  }
}
