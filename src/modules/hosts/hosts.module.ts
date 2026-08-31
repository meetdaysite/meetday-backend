import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { HostsController } from './hosts.controller';
import { HostsService } from './hosts.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { ConsentModule } from '../consent/consent.module';
import { KycService } from './kyc.service';
import { SandboxAuthService } from './sandbox-auth.service';
import { SubscriptionService } from './subscription.service';
import { PennyDropService } from './penny-drop.service';
import { MailProcessor } from './processors/mail.processor';
import { RolesGuard } from '../../common/guards/roles.guard';
import { KYC_PROVIDER } from './interfaces/kyc-provider.interface';
import { StorageModule } from '../../common/storage/storage.module';
import { TeamAccessModule } from '../../common/team-access/team-access.module';

@Module({
  imports: [BullModule.registerQueue({ name: 'mail' }), NotificationsModule, StorageModule, ConsentModule, TeamAccessModule],
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
