import { Module } from '@nestjs/common';
import { ConsentService } from './consent.service';
import { ConsentController } from './consent.controller';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  controllers: [ConsentController],
  providers: [ConsentService, RolesGuard],
  exports: [ConsentService],
})
export class ConsentModule {}
