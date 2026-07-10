import { Module } from '@nestjs/common';
import { AttendeeController } from './attendee.controller';
import { AttendeeService } from './attendee.service';
import { StorageModule } from '../../common/storage/storage.module';

@Module({
  imports: [StorageModule],
  controllers: [AttendeeController],
  providers: [AttendeeService],
})
export class AttendeeModule {}
