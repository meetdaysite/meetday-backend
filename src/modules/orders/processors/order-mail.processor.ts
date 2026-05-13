import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { MailService } from '../../../common/mail/mail.service';
import { TicketPdfService } from '../ticket-pdf.service';

@Processor('mail')
export class OrderMailProcessor {
  private readonly logger = new Logger(OrderMailProcessor.name);

  constructor(
    private readonly mailService: MailService,
    private readonly ticketPdfService: TicketPdfService,
  ) {}

  @Process('ticket-confirmation')
  async handleTicketConfirmation(job: Job<{ orderId: string }>) {
    try {
      const [pdfBuffer, summary] = await Promise.all([
        this.ticketPdfService.generateForOrder(job.data.orderId),
        this.ticketPdfService.getOrderSummary(job.data.orderId),
      ]);
      await this.mailService.sendTicketConfirmation(summary.email, summary.eventTitle, pdfBuffer);
    } catch (error) {
      this.logger.error(`Failed to process ticket-confirmation mail job: ${(error as Error).message}`);
    }
  }
}
