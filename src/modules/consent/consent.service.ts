import { Injectable, NotFoundException } from '@nestjs/common';
import { ConsentType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface GrantConsentParams {
  userId: string;
  consentType: ConsentType;
  version: string;
  consentText: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class ConsentService {
  constructor(private readonly prisma: PrismaService) {}

  async grantConsent(params: GrantConsentParams) {
    // Deactivate any existing active record for this type before creating a new one
    await this.prisma.consentRecord.updateMany({
      where: { userId: params.userId, consentType: params.consentType, isActive: true },
      data: { isActive: false, withdrawnAt: new Date() },
    });

    return this.prisma.consentRecord.create({
      data: {
        userId: params.userId,
        consentType: params.consentType,
        version: params.version,
        consentText: params.consentText,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
        consentedAt: new Date(),
        isActive: true,
      },
    });
  }

  async withdrawConsent(userId: string, consentType: ConsentType): Promise<void> {
    const existing = await this.prisma.consentRecord.findFirst({
      where: { userId, consentType, isActive: true },
    });
    if (!existing) throw new NotFoundException(`No active ${consentType} consent found for this user`);

    await this.prisma.consentRecord.update({
      where: { id: existing.id },
      data: { isActive: false, withdrawnAt: new Date() },
    });
  }

  async hasActiveConsent(userId: string, consentType: ConsentType): Promise<boolean> {
    const record = await this.prisma.consentRecord.findFirst({
      where: { userId, consentType, isActive: true },
      select: { id: true },
    });
    return record !== null;
  }

  async getActiveConsents(userId: string) {
    return this.prisma.consentRecord.findMany({
      where: { userId, isActive: true },
      orderBy: { consentedAt: 'desc' },
    });
  }

  async getUserConsentHistory(userId: string) {
    return this.prisma.consentRecord.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
