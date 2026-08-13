import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ConsentType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { ConsentService } from '../consent/consent.service';
import { RegisterDto } from './dto/register.dto';
import { CompleteProfileDto } from './dto/complete-profile.dto';
import { ADMIN_ALERT_EMAILS } from '../../common/mail/admin-recipients.constant';

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
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly cryptoService: CryptoService,
    private readonly consentService: ConsentService,
    @InjectQueue('mail') private readonly mailQueue: Queue,
  ) {}

  async register(tokenUser: TokenUser, dto: RegisterDto) {
    // Pass `deletedAt: undefined` as an explicit own property to bypass the soft-delete
    // middleware (which uses hasOwnProperty to detect the bypass signal). Prisma ignores
    // undefined values in queries, so this returns all users — active and soft-deleted.
    // We must check both: a soft-deleted account still holds the firebaseUid unique
    // constraint at the DB level and a create would fail if we miss it.
    const existing = await this.prisma.user.findUnique({
      where: { firebaseUid: tokenUser.uid },
      include: { hostProfile: { select: { id: true } }, brandProfile: { select: { id: true } } },
    });

    // A single Firebase identity (host/brand/admin) can hold host, brand, and admin access at
    // once — if this account already exists (e.g. as HOST or an admin), a HOST/BRAND signup
    // attaches the missing profile onto the SAME user row instead of being rejected outright.
    // Re-registering for a profile type they already have (or a plain USER re-register) is
    // still a conflict.
    if (existing) {
      if (dto.accountType === 'HOST' && !existing.hostProfile) {
        return this.attachHostProfile(existing.id, dto);
      }
      if (dto.accountType === 'BRAND' && !existing.brandProfile) {
        return this.attachBrandProfile(existing.id, dto);
      }
      throw new ConflictException('User already registered');
    }

    // Resolve identity fields — token is authoritative for email/phone/avatar
    const resolved = this.resolveIdentity(tokenUser, dto);

    let result: { id: string };
    try {
      if (dto.accountType === 'HOST') {
        result = await this.registerHost(tokenUser.uid, resolved, dto);
      } else if (dto.accountType === 'BRAND') {
        result = await this.registerBrand(tokenUser.uid, resolved, dto);
      } else {
        const userRole = await this.prisma.role.findUniqueOrThrow({ where: { name: 'USER' } });

        result = await this.prisma.user.create({
          data: {
            firebaseUid: tokenUser.uid,
            email: resolved.email,
            phone: resolved.phone,
            firstName: resolved.firstName,
            lastName: resolved.lastName,
            avatarUrl: resolved.avatarUrl,
            roleId: userRole.id,
            ...(dto.vibeType || dto.socialStyle
              ? {
                  attendeeProfile: {
                    create: {
                      vibeType: dto.vibeType,
                      socialStyle: dto.socialStyle,
                    },
                  },
                }
              : {}),
            ...(dto.interests?.length
              ? {
                  interestAffinities: {
                    createMany: {
                      data: dto.interests.map(({ interestId, affinity }) => ({
                        interestId,
                        affinity,
                      })),
                    },
                  },
                }
              : {}),
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
    } catch (err) {
      this.handleUserCreateConflict(err);
    }

    void Promise.all([
      this.consentService.grantConsent({ userId: result.id, consentType: ConsentType.TERMS_OF_SERVICE }),
      this.consentService.grantConsent({ userId: result.id, consentType: ConsentType.PRIVACY_POLICY }),
    ]).catch(() => {});

    // Claim past group-booking attendee rows that match this email, so the new
    // account's event history feeds the social graph.
    if (resolved.email) {
      void this.prisma.orderAttendee
        .updateMany({
          where: { userId: null, email: resolved.email },
          data: { userId: result.id },
        })
        .catch(() => {});
    }

    return result;
  }

  private handleUserCreateConflict(err: unknown): never {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const target = (err.meta?.target as string[] | undefined) ?? [];
      if (target.includes('email')) {
        throw new ConflictException('An account with this email already exists');
      }
      if (target.includes('phone')) {
        throw new ConflictException('An account with this phone number already exists');
      }
      throw new ConflictException('User already registered');
    }
    throw err;
  }

  // Emails the fixed admin-alert recipient list about a new host/brand signup.
  private notifyAdminsOfNewSignup(
    jobName: 'host-welcome' | 'brand-welcome',
    data: Record<string, string | undefined>,
  ) {
    for (const to of ADMIN_ALERT_EMAILS) {
      void this.mailQueue
        .add(jobName, { to, ...data })
        .catch((err) => this.logger.error(`Failed to enqueue ${jobName} mail job`, err));
    }
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
    if (!dto.hostType) {
      throw new BadRequestException('hostType is required when registering as a host');
    }

    const validCategories = await this.prisma.category.findMany({
      where: { id: { in: dto.categoryIds ?? [] } },
      select: { id: true },
    });
    if (validCategories.length !== (dto.categoryIds?.length ?? 0)) {
      throw new BadRequestException('One or more categoryIds are invalid');
    }

    const hostRole = await this.prisma.role.findUniqueOrThrow({ where: { name: 'HOST' } });

    const result = await this.prisma.$transaction(async (tx) => {
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
          communityName: dto.communityName,
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
          // Hosts no longer require manual admin approval before they can act (e.g. raise a
          // sponsorship proposal) — approved immediately at signup.
          approvalStatus: 'APPROVED',
          currentPlan: 'DISCOVER',
          categories: {
            create: (dto.categoryIds ?? []).map((categoryId) => ({ categoryId })),
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

    void this.notifyAdminsOfNewSignup('host-welcome', { hostName: result.firstName, hostEmail: result.email });

    return result;
  }

  private async validateCategoryIds(categoryIds?: string[]) {
    if (!categoryIds?.length) return;
    const validCategories = await this.prisma.category.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true },
    });
    if (validCategories.length !== categoryIds.length) {
      throw new BadRequestException('One or more categoryIds are invalid');
    }
  }

  private async registerBrand(
    firebaseUid: string,
    resolved: ResolvedIdentity,
    dto: RegisterDto,
  ) {
    if (!resolved.email) {
      throw new BadRequestException(
        'email is required for brand registration. Phone-OTP sign-ups must include an email in the request body.',
      );
    }
    await this.validateCategoryIds(dto.categoryIds);

    const brandRole = await this.prisma.role.findUniqueOrThrow({ where: { name: 'BRAND' } });

    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          firebaseUid,
          email: resolved.email,
          phone: resolved.phone,
          firstName: resolved.firstName,
          lastName: resolved.lastName,
          avatarUrl: resolved.avatarUrl,
          roleId: brandRole.id,
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

      const brandProfile = await tx.brandProfile.create({
        data: {
          userId: user.id,
          brandName: dto.brandName ?? '',
          socialLinks: dto.socialLinks ? JSON.parse(JSON.stringify(dto.socialLinks)) : undefined,
          categories: {
            create: (dto.categoryIds ?? []).map((categoryId) => ({ categoryId })),
          },
        },
      });

      return { ...user, brandProfile };
    });

    void this.notifyAdminsOfNewSignup('brand-welcome', { brandName: result.brandProfile.brandName, brandEmail: result.email });

    return result;
  }

  // Attaches a HostProfile to an EXISTING user (e.g. an already-registered BRAND or admin
  // account) — the user's primary `role` is left untouched; HOST access is then granted via
  // hostProfile existence (see RolesGuard).
  private async attachHostProfile(userId: string, dto: RegisterDto) {
    if (!dto.hostType) {
      throw new BadRequestException('hostType is required when registering as a host');
    }

    const validCategories = await this.prisma.category.findMany({
      where: { id: { in: dto.categoryIds ?? [] } },
      select: { id: true },
    });
    if (validCategories.length !== (dto.categoryIds?.length ?? 0)) {
      throw new BadRequestException('One or more categoryIds are invalid');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
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
          userId,
          hostType: dto.hostType,
          gender: dto.gender,
          displayName: dto.displayName,
          legalName: dto.legalName,
          communityName: dto.communityName,
          panEncrypted: dto.pan ? this.cryptoService.encrypt(dto.pan) : undefined,
          hostBio: dto.hostBio,
          tagline: dto.tagline,
          languages: dto.languages ?? [],
          yearsOfExperience: dto.yearsOfExperience,
          totalEventsPreviouslyHosted: dto.totalEventsPreviouslyHosted,
          operatingCities: dto.operatingCities ?? [],
          portfolioLinks: dto.portfolioLinks ?? [],
          socialLinks: dto.socialLinks ? JSON.parse(JSON.stringify(dto.socialLinks)) : undefined,
          kycStatus: 'NOT_SUBMITTED',
          approvalStatus: 'APPROVED',
          currentPlan: 'DISCOVER',
          categories: {
            create: (dto.categoryIds ?? []).map((categoryId) => ({ categoryId })),
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

    void this.notifyAdminsOfNewSignup('host-welcome', { hostName: result.firstName, hostEmail: result.email });

    return result;
  }

  // Attaches a BrandProfile to an EXISTING user (e.g. an already-registered HOST or admin
  // account) — mirrors attachHostProfile above.
  private async attachBrandProfile(userId: string, dto: RegisterDto) {
    await this.validateCategoryIds(dto.categoryIds);

    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
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

      const brandProfile = await tx.brandProfile.create({
        data: {
          userId,
          brandName: dto.brandName ?? '',
          socialLinks: dto.socialLinks ? JSON.parse(JSON.stringify(dto.socialLinks)) : undefined,
          categories: {
            create: (dto.categoryIds ?? []).map((categoryId) => ({ categoryId })),
          },
        },
      });

      return { ...user, brandProfile };
    });

    void this.notifyAdminsOfNewSignup('brand-welcome', { brandName: result.brandProfile.brandName, brandEmail: result.email });

    return result;
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
        adminRole: { select: { name: true } },
        hostProfile: { select: { id: true } },
        brandProfile: { select: { id: true } },
        attendeeProfile: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found. Please register first.');
    }

    // `role` stays whichever account type was registered first (for back-compat with existing
    // frontend checks); `hasHostAccess`/`hasBrandAccess`/`adminRole` expose the full picture for
    // a single identity that holds host, brand, and/or admin access at once.
    const { hostProfile, brandProfile, adminRole, ...rest } = user;
    return {
      ...rest,
      hasHostAccess: !!hostProfile,
      hasBrandAccess: !!brandProfile,
      adminRole: adminRole?.name ?? null,
      avatarUrl: user.avatarUrl
        ? await this.storageService.getPresignedDownloadUrl(user.avatarUrl)
        : null,
    };
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
