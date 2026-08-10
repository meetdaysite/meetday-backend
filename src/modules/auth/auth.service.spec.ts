import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuthService, TokenUser } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { ConsentService } from '../consent/consent.service';
import { StorageService } from '../../common/storage/storage.service';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makePrisma() {
  const prisma: any = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    role: { findUniqueOrThrow: jest.fn() },
    category: { findMany: jest.fn() },
    hostProfile: { create: jest.fn() },
    orderAttendee: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  prisma.$transaction = jest.fn().mockImplementation(async (fn: any) => fn(prisma));
  return prisma;
}

const mockCrypto = { encrypt: jest.fn().mockReturnValue('enc::pan'), decrypt: jest.fn() };

const tokenUser: TokenUser = {
  uid: 'firebase-uid-1',
  email: 'test@example.com',
  provider: 'password',
};

const userRole = { id: 'role-user-id', name: 'USER' };
const hostRole = { id: 'role-host-id', name: 'HOST' };
const createdUser = {
  id: 'user-id',
  email: 'test@example.com',
  phone: null,
  firstName: 'John',
  lastName: 'Doe',
  avatarUrl: null,
  isActive: true,
  role: { name: 'USER' },
  createdAt: new Date(),
};

// ── Test suite ───────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let service: AuthService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: CryptoService, useValue: mockCrypto },
        { provide: ConsentService, useValue: { hasActiveConsent: jest.fn().mockResolvedValue(false), grantConsent: jest.fn().mockResolvedValue(undefined) } },
        { provide: StorageService, useValue: { getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://cdn.example.com/avatar') } },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  // ── register() — USER ─────────────────────────────────────────────────────

  describe('register() — USER', () => {
    it('creates a USER when none exists', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.role.findUniqueOrThrow.mockResolvedValue(userRole);
      prisma.user.create.mockResolvedValue(createdUser);

      const result = await service.register(
        tokenUser,
        { firstName: 'John', lastName: 'Doe', accountType: 'USER' },
      );

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ firebaseUid: tokenUser.uid }) }),
      );
      expect(result).toEqual(createdUser);
    });

    it('throws ConflictException when UID already registered', async () => {
      prisma.user.findUnique.mockResolvedValue(createdUser);

      await expect(
        service.register(tokenUser, { firstName: 'John', lastName: 'Doe' }),
      ).rejects.toThrow(ConflictException);
    });

    it('uses token email over body (identity resolution)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.role.findUniqueOrThrow.mockResolvedValue(userRole);
      prisma.user.create.mockResolvedValue(createdUser);

      await service.register(tokenUser, { firstName: 'John', lastName: 'Doe' });

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: tokenUser.email }),
        }),
      );
    });

    it('throws UnprocessableEntityException when neither email nor phone is available', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const noContactToken: TokenUser = { uid: 'uid', provider: 'password' };

      await expect(
        service.register(noContactToken, { firstName: 'John', lastName: 'Doe' }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws BadRequestException when firstName/lastName absent and displayName not in token', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const minimalToken: TokenUser = { uid: 'uid', email: 'a@b.com', provider: 'password' };

      await expect(
        service.register(minimalToken, {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('splits token displayName into firstName/lastName when body omits them', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.role.findUniqueOrThrow.mockResolvedValue(userRole);
      prisma.user.create.mockResolvedValue({ ...createdUser, firstName: 'Jane', lastName: 'Doe' });

      const googleToken: TokenUser = {
        uid: 'google-uid',
        email: 'jane@gmail.com',
        displayName: 'Jane Doe',
        provider: 'google.com',
      };
      await service.register(googleToken, {});

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ firstName: 'Jane', lastName: 'Doe' }),
        }),
      );
    });
  });

  // ── register() — HOST ─────────────────────────────────────────────────────

  describe('register() — HOST', () => {
    const categoryId = 'cat-uuid-1';
    const hostDto = {
      firstName: 'Priya',
      lastName: 'Nair',
      accountType: 'HOST' as const,
      hostType: 'INDIVIDUAL' as const,
      categoryIds: [categoryId],
      pan: 'ABCDE1234F',
    };
    const hostUser = { ...createdUser, role: { name: 'HOST' } };
    const hostProfile = { id: 'hp-id', userId: 'user-id', kycStatus: 'NOT_SUBMITTED', approvalStatus: 'PENDING', currentPlan: 'DISCOVER', categories: [], address: null };

    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.category.findMany.mockResolvedValue([{ id: categoryId }]);
      prisma.role.findUniqueOrThrow.mockResolvedValue(hostRole);
      prisma.user.create.mockResolvedValue(hostUser);
      prisma.hostProfile.create.mockResolvedValue(hostProfile);
    });

    it('creates User + HostProfile atomically via transaction', async () => {
      const result = await service.register(tokenUser, hostDto);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.user.create).toHaveBeenCalled();
      expect(prisma.hostProfile.create).toHaveBeenCalled();
      expect(result).toMatchObject({ role: { name: 'HOST' }, hostProfile: expect.objectContaining({ kycStatus: 'NOT_SUBMITTED' }) });
    });

    it('encrypts PAN before storing', async () => {
      await service.register(tokenUser, hostDto);

      expect(mockCrypto.encrypt).toHaveBeenCalledWith('ABCDE1234F');
      expect(prisma.hostProfile.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ panEncrypted: 'enc::pan' }),
        }),
      );
    });

    it('sets correct KYC/approval/plan defaults', async () => {
      await service.register(tokenUser, hostDto);

      expect(prisma.hostProfile.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            kycStatus: 'NOT_SUBMITTED',
            approvalStatus: 'APPROVED',
            currentPlan: 'DISCOVER',
          }),
        }),
      );
    });

    it('registers successfully when categoryIds is missing (categories are optional at signup)', async () => {
      prisma.category.findMany.mockResolvedValue([]);
      await expect(
        service.register(tokenUser, { ...hostDto, categoryIds: undefined }),
      ).resolves.toBeDefined();
    });

    it('registers successfully when categoryIds is empty', async () => {
      prisma.category.findMany.mockResolvedValue([]);
      await expect(
        service.register(tokenUser, { ...hostDto, categoryIds: [] }),
      ).resolves.toBeDefined();
    });

    it('throws BadRequestException when hostType is missing', async () => {
      await expect(
        service.register(tokenUser, { ...hostDto, hostType: undefined }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when categoryIds contain invalid UUIDs', async () => {
      prisma.category.findMany.mockResolvedValue([]); // none found

      await expect(
        service.register(tokenUser, hostDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when phone-OTP token has no email and none provided in dto', async () => {
      const phoneTokenUser: TokenUser = { uid: 'fb-phone-uid', phone: '+919876543210', provider: 'phone' };

      await expect(
        service.register(phoneTokenUser, hostDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts dto.email as fallback for phone-OTP HOST registration', async () => {
      const phoneTokenUser: TokenUser = { uid: 'fb-phone-uid', phone: '+919876543210', provider: 'phone' };

      const result = await service.register(phoneTokenUser, { ...hostDto, email: 'priya@example.com' });

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: 'priya@example.com' }),
        }),
      );
      expect(result).toMatchObject({ role: { name: 'HOST' } });
    });
  });

  // ── activateAccount() ─────────────────────────────────────────────────────

  describe('activateAccount()', () => {
    it('sets isActive=true for an inactive invited admin', async () => {
      prisma.user.findUnique.mockResolvedValue({ isActive: false, mustCompleteProfile: true });
      prisma.user.update.mockResolvedValue({ isActive: true, mustCompleteProfile: false, role: userRole });

      await service.activateAccount('firebase-uid');

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { isActive: true, mustCompleteProfile: false },
        }),
      );
    });

    it('throws NotFoundException when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.activateAccount('uid')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when account is already active (mustCompleteProfile=false)', async () => {
      prisma.user.findUnique.mockResolvedValue({ isActive: true, mustCompleteProfile: false });

      await expect(service.activateAccount('uid')).rejects.toThrow(BadRequestException);
    });
  });

  // ── completeProfile() ─────────────────────────────────────────────────────

  describe('completeProfile()', () => {
    const dto = { firstName: 'Aishik', lastName: 'Sikdar', phone: '+919876543210' };

    it('updates firstName, lastName, phone and activates the account', async () => {
      prisma.user.findUnique.mockResolvedValue({ mustCompleteProfile: true });
      prisma.user.update.mockResolvedValue({ ...dto, isActive: true, mustCompleteProfile: false, role: userRole });

      await service.completeProfile('uid', dto);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ firstName: 'Aishik', isActive: true, mustCompleteProfile: false }),
        }),
      );
    });

    it('throws NotFoundException when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.completeProfile('uid', dto)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when profile is already complete', async () => {
      prisma.user.findUnique.mockResolvedValue({ mustCompleteProfile: false });
      await expect(service.completeProfile('uid', dto)).rejects.toThrow(BadRequestException);
    });
  });

  // ── getMe() ───────────────────────────────────────────────────────────────

  describe('getMe()', () => {
    it('returns user with role and userProfile', async () => {
      const fullUser = { ...createdUser, userProfile: null };
      prisma.user.findUnique.mockResolvedValue(fullUser);

      const result = await service.getMe('firebase-uid');
      expect(result).toEqual(fullUser);
    });

    it('throws NotFoundException when user is not registered', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getMe('unknown-uid')).rejects.toThrow(NotFoundException);
    });
  });
});
