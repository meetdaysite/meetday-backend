import { Module } from '@nestjs/common';
import { BrandsController } from './brands.controller';
import { BrandsService } from './brands.service';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  controllers: [BrandsController],
  providers: [BrandsService, RolesGuard],
})
export class BrandsModule {}
