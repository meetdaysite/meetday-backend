import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { PrismaModule } from '../../prisma/prisma.module';
import { SpacesController } from './spaces.controller';
import { SpacesService } from './spaces.service';
import { StorageModule } from '../../common/storage/storage.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { TeamAccessModule } from '../../common/team-access/team-access.module';

@Module({
  imports: [PrismaModule, BullModule.registerQueue({ name: 'mail' }), StorageModule, NotificationsModule, AuditLogModule, TeamAccessModule],
  controllers: [SpacesController],
  providers: [SpacesService],
  exports: [SpacesService],
})
export class SpacesModule {}
