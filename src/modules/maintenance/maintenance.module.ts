import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { MediaGcService } from './media-gc.service';
import { MediaGcCron } from './media-gc.cron';

// Background housekeeping jobs. PrismaModule, StorageModule and AuditLogModule are all @Global,
// but AuditLogModule is imported explicitly to mirror the other cron-owning modules.
@Module({
  imports: [ConfigModule, AuditLogModule],
  providers: [MediaGcService, MediaGcCron],
  exports: [MediaGcService],
})
export class MaintenanceModule {}
