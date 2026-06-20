import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageModule } from '../../common/storage/storage.module';
import { GraphController } from './graph.controller';
import { GraphService } from './graph.service';
import { GraphProcessor } from './graph.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'graph' }),
    NotificationsModule,
    StorageModule,
  ],
  controllers: [GraphController],
  providers: [GraphService, GraphProcessor],
  exports: [GraphService],
})
export class GraphModule {}
