import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TeamAccessService } from './team-access.service';

@Module({
  imports: [BullModule.registerQueue({ name: 'mail' })],
  providers: [TeamAccessService],
  exports: [TeamAccessService],
})
export class TeamAccessModule {}
