import { Module } from '@nestjs/common';
import { BrandsController } from './brands.controller';
import { BrandsService } from './brands.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { StorageModule } from '../../common/storage/storage.module';
import { TeamAccessModule } from '../../common/team-access/team-access.module';

@Module({
  imports: [StorageModule, TeamAccessModule],
  controllers: [BrandsController],
  providers: [BrandsService, RolesGuard],
})
export class BrandsModule {}
