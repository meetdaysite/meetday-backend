import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GetUser } from '../../common/decorators/get-user.decorator';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('SUPER_ADMIN', 'CITY_ADMIN', 'MODERATOR', 'SUPPORT')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('me')
  @ApiOkResponse({ description: 'Returns the authenticated admin profile' })
  getOwnProfile(@GetUser('id') userId: string) {
    return this.adminService.getOwnProfile(userId);
  }
}
