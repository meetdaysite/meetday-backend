import { Module } from '@nestjs/common';
import { SupportTicketController } from './support-ticket.controller';
import { SupportTicketService } from './support-ticket.service';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  controllers: [SupportTicketController],
  providers: [SupportTicketService, RolesGuard],
  exports: [SupportTicketService],
})
export class SupportTicketModule {}
