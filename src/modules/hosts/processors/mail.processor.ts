import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { MailService } from '../../../common/mail/mail.service';

@Processor('mail')
export class MailProcessor {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(private readonly mailService: MailService) {}

  @Process('kyc-failed')
  async handleKycFailed(job: Job<{ to: string; hostName: string; reason: string | null }>) {
    try {
      await this.mailService.sendKycFailed(job.data.to, job.data.hostName, job.data.reason);
    } catch (error) {
      this.logger.error(`Failed to process kyc-failed mail job: ${(error as Error).message}`);
    }
  }

  @Process('host-approved')
  async handleHostApproved(job: Job<{ to: string; hostName: string }>) {
    try {
      await this.mailService.sendHostApproved(job.data.to, job.data.hostName);
    } catch (error) {
      this.logger.error(`Failed to process host-approved mail job: ${(error as Error).message}`);
    }
  }

  @Process('host-rejected')
  async handleHostRejected(job: Job<{ to: string; hostName: string; reason: string }>) {
    try {
      await this.mailService.sendHostRejected(job.data.to, job.data.hostName, job.data.reason);
    } catch (error) {
      this.logger.error(`Failed to process host-rejected mail job: ${(error as Error).message}`);
    }
  }

  @Process('subscription-activated')
  async handleSubscriptionActivated(
    job: Job<{ to: string; hostName: string; plan: string; billingCycle: string }>,
  ) {
    try {
      await this.mailService.sendSubscriptionActivated(
        job.data.to,
        job.data.hostName,
        job.data.plan,
        job.data.billingCycle,
      );
    } catch (error) {
      this.logger.error(`Failed to process subscription-activated mail job: ${(error as Error).message}`);
    }
  }

  @Process('subscription-lapsed')
  async handleSubscriptionLapsed(job: Job<{ to: string; hostName: string; plan: string }>) {
    try {
      await this.mailService.sendSubscriptionLapsed(job.data.to, job.data.hostName, job.data.plan);
    } catch (error) {
      this.logger.error(`Failed to process subscription-lapsed mail job: ${(error as Error).message}`);
    }
  }
}
