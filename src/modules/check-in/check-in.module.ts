import { Module } from '@nestjs/common';
import { CheckInController } from './check-in.controller';
import { CheckInService } from './check-in.service';

@Module({
  controllers: [CheckInController],
  providers: [CheckInService],
  exports: [CheckInService],
})
export class CheckInModule {}
