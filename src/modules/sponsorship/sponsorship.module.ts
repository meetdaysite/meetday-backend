import { Module } from '@nestjs/common';
import { SponsorshipController } from './sponsorship.controller';
import { SponsorshipService } from './sponsorship.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageModule } from '../../common/storage/storage.module';

@Module({
  imports: [NotificationsModule, StorageModule],
  controllers: [SponsorshipController],
  providers: [SponsorshipService],
  exports: [SponsorshipService],
})
export class SponsorshipModule {}
