import { Module } from '@nestjs/common';
import { CommunitiesController } from './communities.controller';
import { CommunitiesAdminController } from './communities-admin.controller';
import { CommunitiesService } from './communities.service';
import { StorageModule } from '../../common/storage/storage.module';
import { ConsentModule } from '../consent/consent.module';

@Module({
  imports: [StorageModule, ConsentModule],
  controllers: [CommunitiesAdminController, CommunitiesController],
  providers: [CommunitiesService],
  exports: [CommunitiesService],
})
export class CommunitiesModule {}
