import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const { uid } = request.user;

    const user = await this.prisma.user.findUnique({
      where: { firebaseUid: uid },
      include: { role: true },
    });

    if (!user || !user.isActive) {
      throw new ForbiddenException('Access denied');
    }

    if (!requiredRoles.includes(user.role.name)) {
      throw new ForbiddenException(
        `Required role: ${requiredRoles.join(' | ')}. Your role: ${user.role.name}`,
      );
    }

    // Enrich request.user with DB profile for downstream use
    request.user = {
      ...request.user,
      id: user.id,
      role: user.role.name,
      isActive: user.isActive,
    };

    return true;
  }
}
