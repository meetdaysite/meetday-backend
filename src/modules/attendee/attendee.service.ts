import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { CreateAttendeeProfileDto } from './dto/create-attendee-profile.dto';
import { UpdateAttendeeProfileDto } from './dto/update-attendee-profile.dto';
import { SetInterestsDto } from './dto/set-interests.dto';

@Injectable()
export class AttendeeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  async createProfile(firebaseUid: string, dto: CreateAttendeeProfileDto) {
    const user = await this.findUser(firebaseUid);

    const existing = await this.prisma.attendeeProfile.findUnique({ where: { userId: user.id } });
    if (existing) {
      return this.performUpdate(user, dto);
    }

    if (dto.username) {
      await this.assertUsernameAvailable(dto.username);
    }

    const profile = await this.prisma.attendeeProfile.create({
      data: { userId: user.id, ...dto },
    });

    return this.toResponse(profile, user.avatarUrl);
  }

  async getOwnProfile(firebaseUid: string) {
    const user = await this.findUser(firebaseUid);

    const profile = await this.prisma.attendeeProfile.findUnique({ where: { userId: user.id } });
    if (!profile) throw new NotFoundException('Attendee profile not found');

    return this.toResponse(profile, user.avatarUrl);
  }

  async updateProfile(firebaseUid: string, dto: UpdateAttendeeProfileDto) {
    const user = await this.findUser(firebaseUid);

    const profile = await this.prisma.attendeeProfile.findUnique({ where: { userId: user.id } });
    if (!profile) throw new NotFoundException('Attendee profile not found');

    return this.performUpdate(user, dto);
  }

  private async performUpdate(
    user: { id: string; avatarUrl: string | null },
    dto: UpdateAttendeeProfileDto,
  ) {
    if (dto.username) {
      const conflict = await this.prisma.attendeeProfile.findUnique({
        where: { username: dto.username },
        select: { userId: true },
      });
      if (conflict && conflict.userId !== user.id) {
        throw new ConflictException('Username is already taken');
      }
    }

    const { avatarKey, ...profileFields } = dto;

    const [profile] = await this.prisma.$transaction([
      this.prisma.attendeeProfile.update({
        where: { userId: user.id },
        data: profileFields,
      }),
      ...(avatarKey
        ? [this.prisma.user.update({ where: { id: user.id }, data: { avatarUrl: avatarKey } })]
        : []),
    ]);

    return this.toResponse(profile, avatarKey ?? user.avatarUrl);
  }

  async getInterests(firebaseUid: string) {
    const user = await this.findUser(firebaseUid);

    const rows = await this.prisma.userInterestAffinity.findMany({
      where: { userId: user.id },
      select: {
        affinity: true,
        interest: { select: { id: true, name: true, slug: true, image: true } },
      },
      orderBy: { interest: { name: 'asc' } },
    });

    const interests = await Promise.all(
      rows.map(async (r) => ({
        interestId: r.interest.id,
        name: r.interest.name,
        slug: r.interest.slug,
        image: r.interest.image ? await this.storageService.getPresignedDownloadUrl(r.interest.image) : null,
        affinity: r.affinity,
      })),
    );

    return { interests, total: interests.length };
  }

  async setInterests(firebaseUid: string, dto: SetInterestsDto) {
    const user = await this.findUser(firebaseUid);

    // De-duplicate by interestId (last write wins) and validate the ids exist.
    const byId = new Map(dto.interests.map((i) => [i.interestId, i.affinity]));
    const interestIds = [...byId.keys()];

    if (interestIds.length) {
      const found = await this.prisma.interest.count({ where: { id: { in: interestIds } } });
      if (found !== interestIds.length) {
        throw new BadRequestException('One or more interestIds are invalid');
      }
    }

    await this.prisma.$transaction([
      this.prisma.userInterestAffinity.deleteMany({ where: { userId: user.id } }),
      this.prisma.userInterestAffinity.createMany({
        data: interestIds.map((interestId) => ({ userId: user.id, interestId, affinity: byId.get(interestId)! })),
        skipDuplicates: true,
      }),
    ]);

    return this.getInterests(firebaseUid);
  }

  private async toResponse(
    profile: Awaited<ReturnType<typeof this.prisma.attendeeProfile.findUniqueOrThrow>>,
    rawAvatarUrl: string | null,
  ) {
    const avatarUrl = rawAvatarUrl
      ? await this.storageService.getPresignedDownloadUrl(rawAvatarUrl)
      : null;

    return { ...profile, avatarUrl };
  }

  private async findUser(firebaseUid: string) {
    const user = await this.prisma.user.findUnique({
      where: { firebaseUid },
      select: { id: true, avatarUrl: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private async assertUsernameAvailable(username: string) {
    const taken = await this.prisma.attendeeProfile.findUnique({
      where: { username },
      select: { id: true },
    });
    if (taken) throw new ConflictException('Username is already taken');
  }
}
