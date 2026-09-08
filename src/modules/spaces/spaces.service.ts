import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateSpaceProfileDto } from './dto/update-space-profile.dto';

@Injectable()
export class SpacesService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(userId: string) {
    const spaceProfile = await this.prisma.spaceProfile.findUnique({
      where: { userId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            phone: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
            isActive: true,
          },
        },
      },
    });

    if (!spaceProfile) {
      throw new NotFoundException('Space Partner profile not found');
    }

    return spaceProfile;
  }

  async updateProfile(userId: string, dto: UpdateSpaceProfileDto) {
    const existing = await this.prisma.spaceProfile.findUnique({ where: { userId } });
    if (!existing) {
      throw new NotFoundException('Space Partner profile not found');
    }

    const updated = await this.prisma.spaceProfile.update({
      where: { userId },
      data: {
        ...(dto.businessName !== undefined && { businessName: dto.businessName }),
        ...(dto.operatingCities !== undefined && { operatingCities: dto.operatingCities }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            phone: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
          },
        },
      },
    });

    return updated;
  }
}
