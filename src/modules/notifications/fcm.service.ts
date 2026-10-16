import { Injectable } from '@nestjs/common';
import * as firebaseAdmin from 'firebase-admin';
import { PrismaService } from '../../prisma/prisma.service';

export interface SendPushNotificationDto {
  userId: string;
  title: string;
  body: string;
  type: 'chat' | 'sponsorship_chat' | 'space_chat' | 'community_chat' | 'brand_community_chat' | 'deal' | 'sponsorship_deal' | 'space_deal' | 'proposal' | 'sponsorship_proposal' | 'support' | 'campaign';
  threadId?: string;
  interestId?: string;
  campaignId?: string;
}

@Injectable()
export class FcmService {
  constructor(private readonly prisma: PrismaService) {}

  async sendPushNotification(payload: SendPushNotificationDto): Promise<void> {
    const { userId, title, body, type, threadId, interestId, campaignId } = payload;

    // Get user's FCM token
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fcmToken: true },
    });

    if (!user?.fcmToken) {
      // User hasn't saved their FCM token yet
      return;
    }

    // Build notification payload
    const message = {
      notification: {
        title,
        body,
      },
      data: {
        type,
        ...(threadId && { threadId }),
        ...(interestId && { interestId }),
        ...(campaignId && { campaignId }),
      },
      token: user.fcmToken,
    };

    try {
      const response = await firebaseAdmin.messaging().send(message);
      console.log(`Push notification sent to user ${userId}: ${response}`);
    } catch (error) {
      // Token might be invalid/revoked - log and continue
      console.error(`Failed to send push notification to user ${userId}:`, error);
      // Optionally clear invalid token
      if (error.code === 'messaging/invalid-registration-token' ||
          error.code === 'messaging/registration-token-not-registered') {
        await this.prisma.user.update({
          where: { id: userId },
          data: { fcmToken: null },
        });
      }
    }
  }

  async sendBulkPushNotifications(
    userIds: string[],
    payload: Omit<SendPushNotificationDto, 'userId'>,
  ): Promise<void> {
    // Get FCM tokens for all users
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, fcmToken: { not: null } },
      select: { id: true, fcmToken: true },
    });

    if (users.length === 0) return;

    const { title, body, type, threadId, interestId, campaignId } = payload;

    // Build messages
    const messages = users.map((user) => ({
      notification: {
        title,
        body,
      },
      data: {
        type,
        ...(threadId && { threadId }),
        ...(interestId && { interestId }),
        ...(campaignId && { campaignId }),
      },
      token: user.fcmToken!,
    }));

    try {
      const response = await firebaseAdmin
        .messaging()
        .sendAll(messages);
      console.log(`Bulk push notification sent to ${response.successCount} users`);

      // Clear tokens for failed messages
      if (response.failureCount > 0) {
        const failedIndices = response.responses
          .map((r, i) => (r.success ? null : i))
          .filter((i) => i !== null) as number[];

        const failedTokens = failedIndices.map((i) => users[i].id);
        if (failedTokens.length > 0) {
          await this.prisma.user.updateMany({
            where: { id: { in: failedTokens } },
            data: { fcmToken: null },
          });
        }
      }
    } catch (error) {
      console.error('Failed to send bulk push notifications:', error);
    }
  }
}
