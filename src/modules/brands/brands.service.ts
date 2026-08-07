import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class BrandsService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        createdAt: true,
        brandProfile: { select: { id: true, brandName: true, createdAt: true, updatedAt: true } },
      },
    });
    if (!user?.brandProfile) throw new NotFoundException('Brand profile not found');

    const { brandProfile, ...rest } = user;
    return { ...rest, ...brandProfile };
  }
}
