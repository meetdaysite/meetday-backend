import { Module } from '@nestjs/common'
import { BrandCommunityCollaborationController } from './brand-community-collaboration.controller'
import { BrandCommunityCollaborationService } from './brand-community-collaboration.service'

@Module({
  controllers: [BrandCommunityCollaborationController],
  providers: [BrandCommunityCollaborationService],
  exports: [BrandCommunityCollaborationService],
})
export class BrandCommunityCollaborationModule {}
