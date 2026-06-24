import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CommunityMemberStatus, CommunityRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MIN_COMMUNITY_ROLE_KEY } from '../decorators/min-community-role.decorator';

const ROLE_HIERARCHY: CommunityRole[] = [
  CommunityRole.MEMBER,
  CommunityRole.MODERATOR,
  CommunityRole.HOST,
  CommunityRole.MANAGER,
  CommunityRole.OWNER,
];

@Injectable()
export class CommunityRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const minRole = this.reflector.getAllAndOverride<CommunityRole>(MIN_COMMUNITY_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!minRole) return true;

    const request = context.switchToHttp().getRequest<{
      user: { uid: string; dbUserId?: string; communityRole?: CommunityRole };
      params: { communityId?: string };
    }>();

    const { uid } = request.user;
    const communityId = request.params.communityId;

    if (!communityId) throw new ForbiddenException('communityId param missing');

    const user = await this.prisma.user.findUnique({
      where: { firebaseUid: uid },
      select: { id: true },
    });
    if (!user) throw new ForbiddenException();

    const member = await this.prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId, userId: user.id } },
      select: { role: true, status: true },
    });

    if (!member || member.status !== CommunityMemberStatus.ACTIVE) {
      throw new ForbiddenException('Not an active member of this community');
    }

    const memberLevel = ROLE_HIERARCHY.indexOf(member.role);
    const requiredLevel = ROLE_HIERARCHY.indexOf(minRole);

    if (memberLevel < requiredLevel) {
      throw new ForbiddenException('Insufficient community role');
    }

    request.user = {
      ...request.user,
      dbUserId: user.id,
      communityRole: member.role,
    };

    return true;
  }
}
