import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SpaceHostInterestController } from './space-host-interest.controller';
import { SpaceHostInterestService } from './space-host-interest.service';
import { StorageModule } from '../../common/storage/storage.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TeamAccessModule } from '../../common/team-access/team-access.module';

@Module({
  imports: [PrismaModule, StorageModule, NotificationsModule, TeamAccessModule],
  controllers: [SpaceHostInterestController],
  providers: [SpaceHostInterestService],
  exports: [SpaceHostInterestService],
})
export class SpaceHostInterestModule {}
