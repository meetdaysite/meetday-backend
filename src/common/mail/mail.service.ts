import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { kycFailedTemplate } from './templates/kyc-failed.template';
import { hostApprovedTemplate } from './templates/host-approved.template';
import { hostRejectedTemplate } from './templates/host-rejected.template';
import { subscriptionActivatedTemplate } from './templates/subscription-activated.template';
import { subscriptionLapsedTemplate } from './templates/subscription-lapsed.template';
import { adminInviteTemplate } from './templates/admin-invite.template';
import { eventApprovedTemplate } from './templates/event-approved.template';
import { eventRejectedTemplate } from './templates/event-rejected.template';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly from: string;

  constructor(private readonly configService: ConfigService) {
    this.from = this.configService.get<string>('mail.from');
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('mail.host'),
      port: this.configService.get<number>('mail.port'),
      secure: this.configService.get<number>('mail.port') === 465,
      auth: {
        user: this.configService.get<string>('mail.user'),
        pass: this.configService.get<string>('mail.pass'),
      },
    });
  }

  private async sendMail(to: string, subject: string, html: string): Promise<void> {
    try {
      await this.transporter.sendMail({ from: this.from, to, subject, html });
      this.logger.log(`Email sent to ${to}: ${subject}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}: ${(error as Error).message}`);
    }
  }

  async sendKycFailed(to: string, hostName: string, reason: string | null): Promise<void> {
    await this.sendMail(to, 'KYC Verification Failed — Meetday', kycFailedTemplate(hostName, reason));
  }

  async sendHostApproved(to: string, hostName: string): Promise<void> {
    await this.sendMail(to, "You're approved as a Meetday Host!", hostApprovedTemplate(hostName));
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
}
