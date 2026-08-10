import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
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

    const request = context.switchToHttp().getRequest();
    const { uid } = request.user;

    const user = await this.prisma.user.findUnique({
      where: { firebaseUid: uid },
      include: { role: true },
    });

    // No DB row at all (never called /auth/register) is a different condition from "wrong
    // role" — surface it the same way /auth/me does (404), so frontend "not registered yet"
    // handling (→ onboarding) fires instead of the "different account type" 403 handling,
    // which is only correct when a User row genuinely exists with a mismatched role.
    if (!user) {
      throw new NotFoundException('User not found. Please register first.');
    }
    if (!user.isActive) {
      throw new ForbiddenException('Access denied');
    }

    // Always enrich request.user with DB profile so @GetUser('id') works
    // regardless of whether @Roles() is applied on the route.
    request.user = {
      ...request.user,
      id: user.id,
      role: user.role.name,
      isActive: user.isActive,
    };

    if (requiredRoles?.length && !requiredRoles.includes(user.role.name)) {
      throw new ForbiddenException(
        'You do not have permission to access this resource.',
      );
    }

    return true;
  }
}
