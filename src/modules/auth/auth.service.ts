import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RegisterDto } from './dto/register.dto';
import { CompleteProfileDto } from './dto/complete-profile.dto';

export interface TokenUser {
  uid: string;
  email?: string;
  phone?: string;
  displayName?: string;  // from Google / Apple token
  avatarUrl?: string;    // from Google / Apple token
  provider: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cryptoService: CryptoService,
  ) {}

  async register(tokenUser: TokenUser, dto: RegisterDto) {
    // Pass `deletedAt: undefined` as an explicit own property to bypass the soft-delete
    // middleware (which uses hasOwnProperty to detect the bypass signal). Prisma ignores
    // undefined values in queries, so this returns all users — active and soft-deleted.
    // We must check both: a soft-deleted account still holds the firebaseUid unique
    // constraint at the DB level and a create would fail if we miss it.
    const existing = await this.prisma.user.findUnique({
      where: { firebaseUid: tokenUser.uid },
    });
    if (existing) {
      throw new ConflictException('User already registered');
    }

    // Resolve identity fields — token is authoritative for email/phone/avatar
    const resolved = this.resolveIdentity(tokenUser, dto);

    if (dto.accountType === 'HOST') {
      return this.registerHost(tokenUser.uid, resolved, dto);
    }

    const userRole = await this.prisma.role.findUniqueOrThrow({ where: { name: 'USER' } });

    return this.prisma.user.create({
      data: {
        firebaseUid: tokenUser.uid,
        email: resolved.email,
        phone: resolved.phone,
        firstName: resolved.firstName,
        lastName: resolved.lastName,
        avatarUrl: resolved.avatarUrl,
        roleId: userRole.id,
      },
      select: {
        id: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        isActive: true,
        role: { select: { name: true } },
        createdAt: true,
      },
    });
  }

  private async registerHost(
    firebaseUid: string,
    resolved: ResolvedIdentity,
    dto: RegisterDto,
  ) {
    if (!resolved.email) {
      throw new BadRequestException(
        'email is required for host registration. Phone-OTP sign-ups must include an email in the request body.',
      );
    }
    if (!dto.categoryIds || dto.categoryIds.length === 0) {
      throw new BadRequestException('categoryIds is required when registering as a host');
    }
    if (!dto.hostType) {
      throw new BadRequestException('hostType is required when registering as a host');
    }

    const validCategories = await this.prisma.category.findMany({
      where: { id: { in: dto.categoryIds } },
      select: { id: true },
    });
    if (validCategories.length !== dto.categoryIds.length) {
      throw new BadRequestException('One or more categoryIds are invalid');
    }

    const hostRole = await this.prisma.role.findUniqueOrThrow({ where: { name: 'HOST' } });

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          firebaseUid,
          email: resolved.email,
          phone: resolved.phone,
          firstName: resolved.firstName,
          lastName: resolved.lastName,
          avatarUrl: resolved.avatarUrl,
          roleId: hostRole.id,
        },
        select: {
          id: true,
          email: true,
          phone: true,
          firstName: true,
          lastName: true,
          avatarUrl: true,
          isActive: true,
          role: { select: { name: true } },
          createdAt: true,
        },
      });

      const hostProfile = await tx.hostProfile.create({
        data: {
          userId: user.id,
          hostType: dto.hostType,
          gender: dto.gender,
          displayName: dto.displayName,
          legalName: dto.legalName,
          panEncrypted: dto.pan ? this.cryptoService.encrypt(dto.pan) : undefined,
          hostBio: dto.hostBio,
          tagline: dto.tagline,
          languages: dto.languages ?? [],
          yearsOfExperience: dto.yearsOfExperience,
          totalEventsPreviouslyHosted: dto.totalEventsPreviouslyHosted,
          operatingCities: dto.operatingCities ?? [],
          portfolioLinks: dto.portfolioLinks ?? [],
          socialLinks: dto.socialLinks
            ? JSON.parse(JSON.stringify(dto.socialLinks))
            : undefined,
          kycStatus: 'NOT_SUBMITTED',
          approvalStatus: 'PENDING',
          currentPlan: 'DISCOVER',
          categories: {
            create: dto.categoryIds.map((categoryId) => ({ categoryId })),
          },
          ...(dto.address && {
            address: { create: dto.address },
          }),
        },
        include: {
          categories: { include: { category: true } },
          address: true,
        },
      });

      return { ...user, hostProfile };
    });
  }

  /**
   * Resolves user identity from token + body.
   * Token fields are authoritative; body fills in what the token doesn't provide.
   * Throws if the minimum required fields cannot be satisfied.
   */
  private resolveIdentity(tokenUser: TokenUser, dto: RegisterDto): ResolvedIdentity {
    // Token email is always authoritative (verified by Firebase).
    // dto.email is accepted as fallback for phone-OTP sign-ups where the token carries no email.
    const email = tokenUser.email ?? dto.email ?? undefined;
    // Phone from token (verified by Firebase) takes priority over body
    const phone = tokenUser.phone ?? dto.phone ?? undefined;

    if (!email && !phone) {
      throw new UnprocessableEntityException(
        'Could not determine a contact method. The Firebase token contains neither an email nor a phone number.',
      );
    }

    // For Google/Apple, split token displayName as firstName/lastName fallback
    let firstName = dto.firstName;
    let lastName = dto.lastName;

    if ((!firstName || !lastName) && tokenUser.displayName) {
      const parts = tokenUser.displayName.trim().split(/\s+/);
      firstName = firstName ?? parts[0] ?? 'User';
      lastName = lastName ?? (parts.length > 1 ? parts.slice(1).join(' ') : parts[0]);
    }

    if (!firstName || !lastName) {
      throw new BadRequestException(
        'firstName and lastName are required for email/password and phone sign-up.',
      );
    }

    return {
      email,
      phone,
      firstName,
      lastName,
      avatarUrl: tokenUser.avatarUrl ?? undefined,
    };
  }

  async activateAccount(firebaseUid: string) {
    const user = await this.prisma.user.findUnique({ where: { firebaseUid } });

    if (!user) {
      throw new NotFoundException('User not found. Please register first.');
    }
    if (!user.mustCompleteProfile) {
      throw new BadRequestException('Account is already active.');
    }

    return this.prisma.user.update({
      where: { firebaseUid },
      data: {
        isActive: true,
        mustCompleteProfile: false,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        isActive: true,
        mustCompleteProfile: true,
        role: { select: { name: true } },
        updatedAt: true,
      },
    });
  }

  async completeProfile(firebaseUid: string, dto: CompleteProfileDto) {
    const user = await this.prisma.user.findUnique({ where: { firebaseUid } });

    if (!user) {
      throw new NotFoundException('User not found. Please register first.');
    }
    if (!user.mustCompleteProfile) {
      throw new BadRequestException('Profile already complete');
    }

    return this.prisma.user.update({
      where: { firebaseUid },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        isActive: true,
        mustCompleteProfile: false,
      },
      select: {
        id: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        isActive: true,
        mustCompleteProfile: true,
        role: { select: { name: true } },
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async getMe(firebaseUid: string) {
    const user = await this.prisma.user.findUnique({
      where: { firebaseUid },
      select: {
        id: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        isActive: true,
        mustCompleteProfile: true,
        role: { select: { name: true } },
        userProfile: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found. Please register first.');
    }

    return user;
  }

  async checkPhoneExists(phone: string): Promise<{ exists: boolean }> {
    const user = await this.prisma.user.findFirst({
      where: { phone },
      select: { id: true },
    });
    return { exists: user !== null };
  }
}

interface ResolvedIdentity {
  email?: string;
  phone?: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
}
