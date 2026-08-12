import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { kycFailedTemplate } from './templates/kyc-failed.template';
import { hostApprovedTemplate } from './templates/host-approved.template';
import { hostRejectedTemplate } from './templates/host-rejected.template';
import { subscriptionActivatedTemplate } from './templates/subscription-activated.template';
import { subscriptionLapsedTemplate } from './templates/subscription-lapsed.template';
import { adminInviteTemplate } from './templates/admin-invite.template';
import { eventApprovedTemplate } from './templates/event-approved.template';
import { eventRejectedTemplate } from './templates/event-rejected.template';
import { scannerInviteTemplate } from './templates/scanner-invite.template';
import { refundInitiatedTemplate } from './templates/refund-initiated.template';
import { refundCompletedTemplate } from './templates/refund-completed.template';
import { refundFailedTemplate } from './templates/refund-failed.template';
import { eventCancelledAttendeeTemplate } from './templates/event-cancelled-attendee.template';
import { eventVenueChangedTemplate } from './templates/event-venue-changed.template';
import { ticketConfirmationTemplate } from './templates/ticket-confirmation.template';
import { newHostSignupTemplate } from './templates/new-host-signup.template';
import { newBrandSignupTemplate } from './templates/new-brand-signup.template';
import { sponsorshipSubmittedTemplate } from './templates/sponsorship-submitted.template';
import { communityProfileSubmittedTemplate } from './templates/community-profile-submitted.template';
import { errorAlertTemplate } from './templates/error-alert.template';

// Admin-facing operational alerts (new signups, pending reviews) are sent from a distinct
// address from the regular user-facing transactional emails (host-approved, tickets, etc).
const ADMIN_NOTIFICATIONS_FROM = 'info@meetday.ai';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend: Resend;
  private readonly from: string;

  constructor(private readonly configService: ConfigService) {
    this.from = this.configService.get<string>('mail.from');
    this.resend = new Resend(this.configService.get<string>('mail.apiKey'));
  }

  private async sendMail(to: string, subject: string, html: string, from: string = this.from): Promise<void> {
    const { error } = await this.resend.emails.send({ from, to, subject, html });
    if (error) {
      this.logger.error(`Failed to send email to ${to}: ${error.message}`);
    } else {
      this.logger.log(`Email sent to ${to}: ${subject}`);
    }
  }

  async sendTicketConfirmation(
    to: string,
    eventTitle: string,
    ticketBuffer: Buffer,
    invoiceBuffer?: Buffer,
  ): Promise<void> {
    const attachments: Array<{ filename: string; content: Buffer }> = [
      { filename: 'tickets.pdf', content: ticketBuffer },
    ];
    // The tax invoice goes to the booker only; plain attendees get just their ticket.
    if (invoiceBuffer) {
      attachments.push({ filename: 'invoice.pdf', content: invoiceBuffer });
    }

    const { error } = await this.resend.emails.send({
      from: this.from,
      to,
      subject: `Your tickets for ${eventTitle} — Meetday`,
      html: ticketConfirmationTemplate(eventTitle, { hasInvoice: !!invoiceBuffer }),
      attachments,
    });
    if (error) {
      this.logger.error(`Failed to send ticket confirmation to ${to}: ${error.message}`);
    } else {
      this.logger.log(`Ticket confirmation email sent to ${to}`);
    }
  }

  async sendKycFailed(to: string, hostName: string, reason: string | null): Promise<void> {
    await this.sendMail(to, 'KYC Verification Failed — Meetday', kycFailedTemplate(hostName, reason));
  }

  async sendHostApproved(to: string, hostName: string): Promise<void> {
    await this.sendMail(to, "You're approved as a Meetday Host!", hostApprovedTemplate(hostName));
  }

  async sendHostWelcome(to: string, hostName: string, hostEmail: string): Promise<void> {
    await this.sendMail(to, 'New host registered — Meetday', newHostSignupTemplate(hostName, hostEmail), ADMIN_NOTIFICATIONS_FROM);
  }

  async sendBrandWelcome(to: string, brandName: string, brandEmail: string): Promise<void> {
    await this.sendMail(to, 'New brand registered — Meetday', newBrandSignupTemplate(brandName, brandEmail), ADMIN_NOTIFICATIONS_FROM);
  }

  async sendSponsorshipSubmitted(to: string, hostName: string, proposalName: string): Promise<void> {
    await this.sendMail(
      to,
      'New sponsorship proposal pending review — Meetday',
      sponsorshipSubmittedTemplate(hostName, proposalName),
      ADMIN_NOTIFICATIONS_FROM,
    );
  }

  async sendCommunityProfileSubmitted(to: string, hostName: string, communityName: string): Promise<void> {
    await this.sendMail(
      to,
      'New community profile pending review — Meetday',
      communityProfileSubmittedTemplate(hostName, communityName),
      ADMIN_NOTIFICATIONS_FROM,
    );
  }

  async sendErrorAlert(to: string, context: string, message: string): Promise<void> {
    await this.sendMail(to, `Unexpected error in ${context} — Meetday`, errorAlertTemplate(context, message), ADMIN_NOTIFICATIONS_FROM);
  }

  async sendHostRejected(to: string, hostName: string, reason: string): Promise<void> {
    await this.sendMail(to, 'Update on your Meetday Host Application', hostRejectedTemplate(hostName, reason));
  }

  async sendSubscriptionActivated(
    to: string,
    hostName: string,
    plan: string,
    billingCycle: string,
  ): Promise<void> {
    await this.sendMail(
      to,
      `Your ${plan} plan is now active — Meetday`,
      subscriptionActivatedTemplate(hostName, plan, billingCycle),
    );
  }

  async sendSubscriptionLapsed(to: string, hostName: string, plan: string): Promise<void> {
    await this.sendMail(to, 'Your Meetday subscription has expired', subscriptionLapsedTemplate(hostName, plan));
  }

  async sendAdminInvite(to: string, roleName: string, resetLink: string): Promise<void> {
    await this.sendMail(to, `You've been invited to Meetday as ${roleName}`, adminInviteTemplate(to, roleName, resetLink));
  }

  async sendEventApproved(to: string, hostName: string, eventTitle: string): Promise<void> {
    await this.sendMail(to, 'Your event has been approved — Meetday', eventApprovedTemplate(hostName, eventTitle));
  }

  async sendEventRejected(to: string, hostName: string, eventTitle: string, remark: string): Promise<void> {
    await this.sendMail(to, 'Update on your Meetday event listing', eventRejectedTemplate(hostName, eventTitle, remark));
  }

  async sendScannerInvite(
    to: string,
    staffName: string,
    eventTitle: string,
    scannerUrl: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.sendMail(
      to,
      `You've been assigned as a ticket scanner for ${eventTitle} — Meetday`,
      scannerInviteTemplate(staffName, eventTitle, scannerUrl, expiresAt),
    );
  }

  async sendRefundInitiated(to: string, firstName: string, amountRupees: number, eventTitle: string): Promise<void> {
    await this.sendMail(to, `Refund initiated for ${eventTitle} — Meetday`, refundInitiatedTemplate(firstName, amountRupees, eventTitle));
  }

  async sendRefundCompleted(to: string, firstName: string, amountRupees: number, eventTitle: string): Promise<void> {
    await this.sendMail(to, `Refund processed for ${eventTitle} — Meetday`, refundCompletedTemplate(firstName, amountRupees, eventTitle));
  }

  async sendRefundFailed(to: string, firstName: string, amountRupees: number): Promise<void> {
    await this.sendMail(to, 'Action required: refund issue — Meetday', refundFailedTemplate(firstName, amountRupees));
  }

  async sendEventCancelledAttendee(
    to: string,
    firstName: string,
    eventTitle: string,
    cancellationReason: string,
    refundAmountRupees: number,
  ): Promise<void> {
    await this.sendMail(
      to,
      `Event cancelled: ${eventTitle} — Meetday`,
      eventCancelledAttendeeTemplate(firstName, eventTitle, cancellationReason, refundAmountRupees),
    );
  }

  async sendEventVenueChanged(
    to: string,
    firstName: string,
    eventTitle: string,
    venueName: string | null,
    fullAddress: string | null,
    city: string | null,
  ): Promise<void> {
    await this.sendMail(
      to,
      `Venue changed: ${eventTitle} — Meetday`,
      eventVenueChangedTemplate(firstName, eventTitle, venueName, fullAddress, city),
    );
  }
}
