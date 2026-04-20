import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { HostsController } from './hosts.controller';
import { HostsService } from './hosts.service';
import { KycService } from './kyc.service';
import { SandboxAuthService } from './sandbox-auth.service';
import { SubscriptionService } from './subscription.service';
import { PennyDropService } from './penny-drop.service';
import { MailProcessor } from './processors/mail.processor';
import { RolesGuard } from '../../common/guards/roles.guard';
import { KYC_PROVIDER } from './interfaces/kyc-provider.interface';

@Module({
  imports: [BullModule.registerQueue({ name: 'mail' })],
  controllers: [HostsController],
  providers: [
    HostsService,
    SandboxAuthService,
    SubscriptionService,
    PennyDropService,
    RolesGuard,
    { provide: KYC_PROVIDER, useClass: KycService },
    MailProcessor,
  ],
  exports: [HostsService],
})
export class HostsModule {}
