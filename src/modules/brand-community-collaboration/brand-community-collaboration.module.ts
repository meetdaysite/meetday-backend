import { Module } from '@nestjs/common'
import { NotificationsModule } from '../notifications/notifications.module'
import { BrandCommunityCollaborationController } from './brand-community-collaboration.controller'
import { BrandCommunityCollaborationService } from './brand-community-collaboration.service'

@Module({
  imports: [NotificationsModule],
  controllers: [BrandCommunityCollaborationController],
  providers: [BrandCommunityCollaborationService],
  exports: [BrandCommunityCollaborationService],
})
export class BrandCommunityCollaborationModule {}
