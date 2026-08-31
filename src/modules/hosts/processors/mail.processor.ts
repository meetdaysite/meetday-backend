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

  @Process('admin-invite')
  async handleAdminInvite(job: Job<{ to: string; roleName: string; resetLink: string }>) {
    try {
      await this.mailService.sendAdminInvite(job.data.to, job.data.roleName, job.data.resetLink);
    } catch (error) {
      this.logger.error(`Failed to process admin-invite mail job: ${(error as Error).message}`);
    }
  }

  @Process('team-invite')
  async handleTeamInvite(
    job: Job<{ to: string; inviterName: string; accountName: string; accountTypeLabel: string; signupUrl: string }>,
  ) {
    try {
      await this.mailService.sendTeamInvite(
        job.data.to,
        job.data.inviterName,
        job.data.accountName,
        job.data.accountTypeLabel,
        job.data.signupUrl,
      );
    } catch (error) {
      this.logger.error(`Failed to process team-invite mail job: ${(error as Error).message}`);
    }
  }

  @Process('event-approved')
  async handleEventApproved(job: Job<{ to: string; hostName: string; eventTitle: string }>) {
    try {
      await this.mailService.sendEventApproved(job.data.to, job.data.hostName, job.data.eventTitle);
    } catch (error) {
      this.logger.error(`Failed to process event-approved mail job: ${(error as Error).message}`);
    }
  }

  @Process('event-rejected')
  async handleEventRejected(job: Job<{ to: string; hostName: string; eventTitle: string; remark: string }>) {
    try {
      await this.mailService.sendEventRejected(job.data.to, job.data.hostName, job.data.eventTitle, job.data.remark);
    } catch (error) {
      this.logger.error(`Failed to process event-rejected mail job: ${(error as Error).message}`);
    }
  }

  @Process('event-venue-changed')
  async handleEventVenueChanged(
    job: Job<{
      to: string;
      firstName: string;
      eventTitle: string;
      venueName: string | null;
      fullAddress: string | null;
      city: string | null;
    }>,
  ) {
    try {
      await this.mailService.sendEventVenueChanged(
        job.data.to,
        job.data.firstName,
        job.data.eventTitle,
        job.data.venueName,
        job.data.fullAddress,
        job.data.city,
      );
    } catch (error) {
      this.logger.error(`Failed to process event-venue-changed mail job: ${(error as Error).message}`);
    }
  }

  @Process('host-welcome')
  async handleHostWelcome(job: Job<{ to: string; hostName: string; hostEmail: string }>) {
    try {
      await this.mailService.sendHostWelcome(job.data.to, job.data.hostName, job.data.hostEmail);
    } catch (error) {
      this.logger.error(`Failed to process host-welcome mail job: ${(error as Error).message}`);
    }
  }

  @Process('brand-welcome')
  async handleBrandWelcome(job: Job<{ to: string; brandName: string; brandEmail: string }>) {
    try {
      await this.mailService.sendBrandWelcome(job.data.to, job.data.brandName, job.data.brandEmail);
    } catch (error) {
      this.logger.error(`Failed to process brand-welcome mail job: ${(error as Error).message}`);
    }
  }

  @Process('sponsorship-submitted')
  async handleSponsorshipSubmitted(job: Job<{ to: string; hostName: string; proposalName: string }>) {
    try {
      await this.mailService.sendSponsorshipSubmitted(job.data.to, job.data.hostName, job.data.proposalName);
    } catch (error) {
      this.logger.error(`Failed to process sponsorship-submitted mail job: ${(error as Error).message}`);
    }
  }

  @Process('community-profile-submitted')
  async handleCommunityProfileSubmitted(job: Job<{ to: string; hostName: string; communityName: string }>) {
    try {
      await this.mailService.sendCommunityProfileSubmitted(job.data.to, job.data.hostName, job.data.communityName);
    } catch (error) {
      this.logger.error(`Failed to process community-profile-submitted mail job: ${(error as Error).message}`);
    }
  }

  @Process('error-alert')
  async handleErrorAlert(job: Job<{ to: string; context: string; message: string; userLabel?: string }>) {
    try {
      await this.mailService.sendErrorAlert(job.data.to, job.data.context, job.data.message, job.data.userLabel);
    } catch (error) {
      this.logger.error(`Failed to process error-alert mail job: ${(error as Error).message}`);
    }
  }

  @Process('user-action')
  async handleUserAction(job: Job<{ to: string; userLabel: string; method: string; path: string }>) {
    try {
      await this.mailService.sendUserAction(job.data.to, job.data.userLabel, job.data.method, job.data.path);
    } catch (error) {
      this.logger.error(`Failed to process user-action mail job: ${(error as Error).message}`);
    }
  }

  @Process('announcement')
  async handleAnnouncement(job: Job<{ to: string; subject: string; message: string }>) {
    try {
      await this.mailService.sendAnnouncement(job.data.to, job.data.subject, job.data.message);
    } catch (error) {
      this.logger.error(`Failed to process announcement mail job: ${(error as Error).message}`);
    }
  }

  @Process('brand-interest')
  async handleBrandInterest(
    job: Job<{
      to: string;
      communityName: string;
      proposalName: string;
      brandName: string;
      brandEmail: string;
      categories: string[];
      socialLinks: Record<string, string | undefined>;
    }>,
  ) {
    try {
      await this.mailService.sendBrandInterest(
        job.data.to,
        job.data.communityName,
        job.data.proposalName,
        job.data.brandName,
        job.data.brandEmail,
        job.data.categories,
        job.data.socialLinks,
      );
    } catch (error) {
      this.logger.error(`Failed to process brand-interest mail job: ${(error as Error).message}`);
    }
  }
}
