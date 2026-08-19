import { Module } from '@nestjs/common';
import { MeetdayChatController } from './meetday-chat.controller';
import { MeetdayChatService } from './meetday-chat.service';
import { StorageModule } from '../../common/storage/storage.module';

@Module({
  imports: [StorageModule],
  controllers: [MeetdayChatController],
  providers: [MeetdayChatService],
})
export class MeetdayChatModule {}
