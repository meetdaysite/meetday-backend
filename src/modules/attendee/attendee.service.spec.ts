import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AttendeeService } from './attendee.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePrisma() {
  const prisma: any = {
    user: { findUnique: jest.fn() },
    attendeeProfile: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  return prisma;
}

const mockStorage = { getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://cdn.example.com/avatar') };

// ── Fixtures ──────────────────────────────────────────────────────────────────

const firebaseUid = 'firebase-uid-1';
const userId = 'user-uuid';
const profileId = 'profile-uuid';

const userRecord = { id: userId, avatarUrl: null };
const userWithAvatar = { id: userId, avatarUrl: 'avatars/user.jpg' };

const profileRecord = {
  id: profileId,
  userId,
  username: 'riyasen',
  bio: 'Music lover',
  interests: [],
};

// ── Test suite ────────────────────────────────────────────────────────────────

describe('AttendeeService', () => {
  let service: AttendeeService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();

    const module = await Test.createTestingModule({
      providers: [
        AttendeeService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: mockStorage },
      ],
    }).compile();

    service = module.get(AttendeeService);
    jest.clearAllMocks();
  });

  // ── createProfile ─────────────────────────────────────────────────────────

  describe('createProfile()', () => {
    const dto: any = { username: 'riyasen', bio: 'Music lover' };

    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(userRecord);
      prisma.attendeeProfile.findUnique.mockResolvedValue(null);
      prisma.attendeeProfile.create.mockResolvedValue(profileRecord);
    });

    it('creates a new profile when none exists', async () => {
      const result = await service.createProfile(firebaseUid, dto);
      expect(prisma.attendeeProfile.create).toHaveBeenCalled();
      expect(result).toMatchObject({ username: 'riyasen' });
    });

    it('calls update instead of create when profile already exists', async () => {
      prisma.attendeeProfile.findUnique
        .mockResolvedValueOnce(profileRecord) // profile exists check
        .mockResolvedValueOnce(null); // username conflict check in performUpdate
      prisma.attendeeProfile.update.mockResolvedValue({ ...profileRecord, bio: 'Updated bio' });

      await service.createProfile(firebaseUid, { ...dto, bio: 'Updated bio' });
      expect(prisma.attendeeProfile.create).not.toHaveBeenCalled();
      expect(prisma.attendeeProfile.update).toHaveBeenCalled();
    });

    it('throws ConflictException when username is already taken on create', async () => {
      prisma.attendeeProfile.findUnique
        .mockResolvedValueOnce(null) // no existing profile for this user
        .mockResolvedValueOnce({ id: 'other-profile' }); // username taken by someone else

      await expect(service.createProfile(firebaseUid, dto)).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.createProfile(firebaseUid, dto)).rejects.toThrow(NotFoundException);
    });

    it('resolves signed avatarUrl when user has an avatar', async () => {
      prisma.user.findUnique.mockResolvedValue(userWithAvatar);
      prisma.attendeeProfile.findUnique.mockResolvedValue(null);
      prisma.attendeeProfile.create.mockResolvedValue(profileRecord);

      const result = await service.createProfile(firebaseUid, dto);
      expect(mockStorage.getPresignedDownloadUrl).toHaveBeenCalledWith('avatars/user.jpg');
      expect(result.avatarUrl).toBe('https://cdn.example.com/avatar');
    });

    it('returns null avatarUrl when user has no avatar', async () => {
      const result = await service.createProfile(firebaseUid, dto);
      expect(result.avatarUrl).toBeNull();
    });
  });

  // ── getOwnProfile ─────────────────────────────────────────────────────────

  describe('getOwnProfile()', () => {
    it('returns the profile when it exists', async () => {
      prisma.user.findUnique.mockResolvedValue(userRecord);
      prisma.attendeeProfile.findUnique.mockResolvedValue(profileRecord);

      const result = await service.getOwnProfile(firebaseUid);
      expect(result).toMatchObject({ username: 'riyasen' });
    });

    it('throws NotFoundException when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getOwnProfile(firebaseUid)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when profile does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(userRecord);
      prisma.attendeeProfile.findUnique.mockResolvedValue(null);
      await expect(service.getOwnProfile(firebaseUid)).rejects.toThrow(NotFoundException);
    });
  });

  // ── updateProfile ─────────────────────────────────────────────────────────

  describe('updateProfile()', () => {
    const dto: any = { bio: 'Updated bio' };

    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(userRecord);
      prisma.attendeeProfile.findUnique.mockResolvedValue(profileRecord);
      prisma.attendeeProfile.update.mockResolvedValue({ ...profileRecord, bio: 'Updated bio' });
    });

    it('updates and returns the profile', async () => {
      // performUpdate: no username in dto, so no conflict check
      prisma.attendeeProfile.update.mockResolvedValue({ ...profileRecord, bio: 'Updated bio' });
      const result = await service.updateProfile(firebaseUid, dto);
      expect(prisma.attendeeProfile.update).toHaveBeenCalled();
      expect(result).toMatchObject({ bio: 'Updated bio' });
    });

    it('throws NotFoundException when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.updateProfile(firebaseUid, dto)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when profile does not exist', async () => {
      prisma.attendeeProfile.findUnique.mockResolvedValue(null);
      await expect(service.updateProfile(firebaseUid, dto)).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when new username is taken by another user', async () => {
      prisma.attendeeProfile.findUnique
        .mockResolvedValueOnce(profileRecord) // exists check in updateProfile
        .mockResolvedValueOnce({ userId: 'other-user' }); // username conflict in performUpdate

      await expect(
        service.updateProfile(firebaseUid, { username: 'takenname' }),
      ).rejects.toThrow(ConflictException);
    });

    it('allows updating to own current username without conflict', async () => {
      prisma.attendeeProfile.findUnique
        .mockResolvedValueOnce(profileRecord) // exists check
        .mockResolvedValueOnce({ userId }); // same user owns the username

      prisma.attendeeProfile.update.mockResolvedValue({ ...profileRecord });
      await expect(
        service.updateProfile(firebaseUid, { username: 'riyasen' }),
      ).resolves.toBeDefined();
    });
  });
});
