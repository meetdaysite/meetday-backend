import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PutKeyBackupDto } from './dto/key-backup.dto';
import { RegisterDeviceDto } from './dto/register-device.dto';

const DEVICE_SELECT = {
  id: true,
  deviceId: true,
  identityPublicKey: true,
  signingPublicKey: true,
  label: true,
  lastSeenAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

@Injectable()
export class E2eeService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveUserId(firebaseUid: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { firebaseUid }, select: { id: true } });
    if (!user) throw new NotFoundException('User not found');
    return user.id;
  }

  /** Register or re-publish a device's public keys (idempotent on (userId, deviceId)). */
  async registerDevice(firebaseUid: string, dto: RegisterDeviceDto) {
    const userId = await this.resolveUserId(firebaseUid);
    return this.prisma.userDevice.upsert({
      where: { userId_deviceId: { userId, deviceId: dto.deviceId } },
      create: {
        userId,
        deviceId: dto.deviceId,
        identityPublicKey: dto.identityPublicKey,
        signingPublicKey: dto.signingPublicKey,
        label: dto.label,
        lastSeenAt: new Date(),
      },
      update: {
        identityPublicKey: dto.identityPublicKey,
        signingPublicKey: dto.signingPublicKey,
        label: dto.label,
        lastSeenAt: new Date(),
        revokedAt: null, // re-registering un-revokes
      },
      select: DEVICE_SELECT,
    });
  }

  async listMyDevices(firebaseUid: string) {
    const userId = await this.resolveUserId(firebaseUid);
    return this.prisma.userDevice.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: DEVICE_SELECT,
    });
  }

  async revokeDevice(firebaseUid: string, deviceId: string) {
    const userId = await this.resolveUserId(firebaseUid);
    const device = await this.prisma.userDevice.findUnique({
      where: { userId_deviceId: { userId, deviceId } },
      select: { id: true },
    });
    if (!device) throw new NotFoundException('Device not found');

    await this.prisma.userDevice.update({
      where: { userId_deviceId: { userId, deviceId } },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  /** Active (non-revoked) device public keys for a user — the bundle to wrap K to. */
  async getActiveDeviceKeys(userId: string) {
    return this.prisma.userDevice.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { deviceId: true, identityPublicKey: true, signingPublicKey: true, label: true },
    });
  }

  // ─── Encrypted key backup ───────────────────────────────────────────────────

  async putKeyBackup(firebaseUid: string, dto: PutKeyBackupDto) {
    const userId = await this.resolveUserId(firebaseUid);
    await this.prisma.userKeyBackup.upsert({
      where: { userId },
      create: {
        userId,
        wrappedMasterKey: dto.wrappedMasterKey,
        kdfParams: dto.kdfParams as Prisma.InputJsonValue,
      },
      update: {
        wrappedMasterKey: dto.wrappedMasterKey,
        kdfParams: dto.kdfParams as Prisma.InputJsonValue,
      },
    });
    return { success: true };
  }

  async getKeyBackup(firebaseUid: string) {
    const userId = await this.resolveUserId(firebaseUid);
    const backup = await this.prisma.userKeyBackup.findUnique({
      where: { userId },
      select: { wrappedMasterKey: true, kdfParams: true, updatedAt: true },
    });
    if (!backup) throw new NotFoundException('No key backup found');
    return backup;
  }

  /**
   * Conversations whose current epoch is missing a device-key wrap for one of my
   * devices — lets an online device (holding K) provision my newly-added devices.
   */
  async listDmKeyWrapRequests(firebaseUid: string) {
    const userId = await this.resolveUserId(firebaseUid);

    const [devices, convos] = await Promise.all([
      this.prisma.userDevice.findMany({ where: { userId, revokedAt: null }, select: { deviceId: true } }),
      this.prisma.communityDmConversation.findMany({
        where: {
          status: { in: ['PENDING', 'ACCEPTED'] },
          OR: [{ participant1Id: userId }, { participant2Id: userId }],
        },
        select: { id: true, currentEpoch: true },
      }),
    ]);
    if (devices.length === 0 || convos.length === 0) return [];

    const existing = await this.prisma.dmConversationDeviceKey.findMany({
      where: { recipientUserId: userId, conversationId: { in: convos.map((c) => c.id) } },
      select: { conversationId: true, recipientDeviceId: true, epoch: true },
    });
    const have = new Set(existing.map((e) => `${e.conversationId}:${e.recipientDeviceId}:${e.epoch}`));

    const requests: { conversationId: string; deviceId: string; epoch: number }[] = [];
    for (const c of convos) {
      for (const d of devices) {
        if (!have.has(`${c.id}:${d.deviceId}:${c.currentEpoch}`)) {
          requests.push({ conversationId: c.id, deviceId: d.deviceId, epoch: c.currentEpoch });
        }
      }
    }
    return requests;
  }
}
