import { Module } from '@nestjs/common'
import { CommunityCollaborationService } from './community-collaboration.service'
import { CommunityCollaborationController } from './community-collaboration.controller'
import { PrismaModule } from '@/src/prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  controllers: [CommunityCollaborationController],
  providers: [CommunityCollaborationService],
  exports: [CommunityCollaborationService],
})
export class CommunityCollaborationModule {}
