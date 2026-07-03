import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { MailService } from '../../../common/mail/mail.service';
import { TicketPdfService } from '../ticket-pdf.service';
import { InvoicePdfService } from '../invoice-pdf.service';

@Processor('mail')
export class OrderMailProcessor {
  private readonly logger = new Logger(OrderMailProcessor.name);

  constructor(
    private readonly mailService: MailService,
    private readonly ticketPdfService: TicketPdfService,
    private readonly invoicePdfService: InvoicePdfService,
  ) {}

  @Process('ticket-confirmation')
  async handleTicketConfirmation(job: Job<{ orderId: string }>) {
    const { orderId } = job.data;
    try {
      // persistForOrder renders + uploads the full ticket PDF and the invoice so
      // the download endpoints can serve them. In parallel we build one ticket PDF
      // per email recipient: each attendee gets only their own ticket, and the
      // booker's bucket additionally carries the invoice.
      const [, { buffer: invoiceBuffer }, { eventTitle, recipients }] = await Promise.all([
        this.ticketPdfService.persistForOrder(orderId),
        this.invoicePdfService.persistForOrder(orderId),
        this.ticketPdfService.generateRecipientTickets(orderId),
      ]);

      if (recipients.length === 0) {
        this.logger.warn(`No emailable recipients for order ${orderId}: nobody has an email address`);
        return;
      }

      for (const recipient of recipients) {
        await this.mailService.sendTicketConfirmation(
          recipient.email,
          eventTitle,
          recipient.buffer,
          recipient.isBooker ? invoiceBuffer : undefined,
        );
      }
    } catch (error) {
      this.logger.error(`Failed to process ticket-confirmation mail job: ${(error as Error).message}`);
    }
  }
}
