import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { UpdateBrandProfileDto } from './dto/update-brand-profile.dto';

const BRAND_PROFILE_SELECT = {
  id: true,
  brandName: true,
  socialLinks: true,
  workEmail: true,
  contactPhone: true,
  logoKey: true,
  companyType: true,
  aboutCompany: true,
  industry: true,
  createdAt: true,
  updatedAt: true,
  categories: { select: { category: { select: { id: true, name: true } } } },
} as const;

function isProfileComplete(brandProfile: {
  brandName: string;
  socialLinks: unknown;
  categories: unknown[];
}): boolean {
  const links = (brandProfile.socialLinks ?? {}) as Record<string, string | undefined>;
  const hasSocialLink = Object.values(links).some((v) => !!v);
  return !!brandProfile.brandName && brandProfile.categories.length > 0 && hasSocialLink;
}

@Injectable()
export class BrandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

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
        brandProfile: { select: BRAND_PROFILE_SELECT },
      },
    });
    if (!user?.brandProfile) throw new NotFoundException('Brand profile not found');

    const { brandProfile, ...rest } = user;
    const { categories, logoKey, ...brandRest } = brandProfile;
    return {
      ...rest,
      ...brandRest,
      logoUrl: logoKey ? await this.storageService.getPresignedDownloadUrl(logoKey) : null,
      categories: categories.map((c) => c.category),
      isProfileComplete: isProfileComplete({ ...brandProfile, categories }),
    };
  }

  async updateProfile(userId: string, dto: UpdateBrandProfileDto) {
    const profile = await this.prisma.brandProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!profile) throw new NotFoundException('Brand profile not found');

    if (dto.categoryIds !== undefined) {
      const validCategories = await this.prisma.category.findMany({
        where: { id: { in: dto.categoryIds } },
        select: { id: true },
      });
      if (validCategories.length !== dto.categoryIds.length) {
        throw new BadRequestException('One or more categoryIds are invalid');
      }

      await this.prisma.$transaction([
        this.prisma.brandExperienceCategory.deleteMany({ where: { brandProfileId: profile.id } }),
        this.prisma.brandExperienceCategory.createMany({
          data: dto.categoryIds.map((categoryId) => ({ brandProfileId: profile.id, categoryId })),
        }),
      ]);
    }

    await this.prisma.brandProfile.update({
      where: { id: profile.id },
      data: {
        ...(dto.brandName !== undefined && { brandName: dto.brandName }),
        ...(dto.socialLinks !== undefined && {
          socialLinks: JSON.parse(JSON.stringify(dto.socialLinks)),
        }),
        ...(dto.workEmail !== undefined && { workEmail: dto.workEmail }),
        ...(dto.contactPhone !== undefined && { contactPhone: dto.contactPhone }),
        ...(dto.logoKey !== undefined && { logoKey: dto.logoKey }),
        ...(dto.companyType !== undefined && { companyType: dto.companyType }),
        ...(dto.aboutCompany !== undefined && { aboutCompany: dto.aboutCompany }),
        ...(dto.industry !== undefined && { industry: dto.industry }),
        approvalStatus: 'PENDING',
      },
    });

    return this.getMe(userId);
  }
}
