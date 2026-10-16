# FCM Push Notifications - Backend Usage Guide

## Overview

The backend now supports sending push notifications to mobile users via Firebase Cloud Messaging (FCM). Notifications are routed directly to the user's mobile app with payload data for deep linking.

## Architecture

```
Mobile App                        Backend                      Firebase
─────────────────────────────────────────────────────────────────────
1. Get FCM token
2. POST /users/fcm-token ──────────────────────────────────────────────>
3. Backend stores token           Save to user.fcmToken
4. App receives notification  <─────────────────── FCM sends notification
                                   FcmService.sendPushNotification()
```

## Token Management

### Saving Token (Mobile → Backend)

**Endpoint:** `POST /users/fcm-token`
**Auth:** Bearer token required
**Body:**
```json
{
  "fcmToken": "eUm5X9dIL4o:APA91b..."
}
```

**Response:**
```json
{
  "message": "FCM token updated successfully"
}
```

### Getting User's Token

```typescript
const user = await prisma.user.findUnique({
  where: { id: userId },
  select: { fcmToken: true }
});
```

## Sending Notifications

### Single User Notification

```typescript
import { FcmService } from './modules/notifications/fcm.service';

constructor(private readonly fcmService: FcmService) {}

async sendChatNotification(userId: string, threadId: string) {
  await this.fcmService.sendPushNotification({
    userId,
    title: 'New Message',
    body: 'You have a new message in chat',
    type: 'chat',
    threadId,
  });
}
```

### Bulk Notifications

```typescript
await this.fcmService.sendBulkPushNotifications(
  [userId1, userId2, userId3],
  {
    title: 'Deal Update',
    body: 'A deal you matched with has been updated',
    type: 'deal',
    interestId: 'interest-123',
  }
);
```

## Notification Types and Routing

| Type | Route | Required Field | Example Usage |
|------|-------|---|---|
| `chat` | `/chat/{threadId}` | `threadId` | New hub chat message |
| `sponsorship_chat` | `/chat/{threadId}` | `threadId` | Sponsorship chat message |
| `space_chat` | `/chat/{threadId}` | `threadId` | Space chat message |
| `community_chat` | `/chat/{threadId}` | `threadId` | Community collaboration message |
| `brand_community_chat` | `/chat/{threadId}` | `threadId` | Brand-community message |
| `deal` | `/deals/{interestId}` | `interestId` | Deal terms updated |
| `sponsorship_deal` | `/deals/{interestId}` | `interestId` | Sponsorship deal update |
| `space_deal` | `/deals/{interestId}` | `interestId` | Space deal update |
| `proposal` | `/proposals/{interestId}` | `interestId` | Proposal response |
| `sponsorship_proposal` | `/proposals/{interestId}` | `interestId` | Sponsorship proposal |
| `support` | `/support` | - | Support response |
| `campaign` | `/campaigns/{campaignId}` | `campaignId` | Campaign update |

## Integration Examples

### Chat Messages

```typescript
// In your chat message creation/update logic
async createChatMessage(threadId: string, senderId: string, body: string) {
  // Create message in DB
  const message = await this.prisma.meetdayChatMessage.create({
    data: { threadId, senderId, body },
  });

  // Get chat participants (except sender)
  const thread = await this.prisma.meetdayChatThread.findUnique({
    where: { id: threadId },
    select: { participant1Id: true, participant2Id: true },
  });

  const recipientId = thread.participant1Id === senderId 
    ? thread.participant2Id 
    : thread.participant1Id;

  // Send push notification
  await this.fcmService.sendPushNotification({
    userId: recipientId,
    title: 'New Message',
    body: message.body.substring(0, 50),
    type: 'chat',
    threadId,
  });
}
```

### Deal Updates

```typescript
async updateDeal(interestId: string, updatedData: any) {
  const deal = await this.prisma.sponsorshipDeal.update({
    where: { id: interestId },
    data: updatedData,
  });

  // Get the interest and find connected users
  const interest = await this.prisma.sponsorshipInterest.findUnique({
    where: { id: deal.sponsorshipInterestId },
    select: { userId: true, createdBy: true },
  });

  // Notify both parties
  await this.fcmService.sendBulkPushNotifications(
    [interest.userId, interest.createdBy],
    {
      title: 'Deal Update',
      body: 'The deal terms have been updated',
      type: 'sponsorship_deal',
      interestId,
    }
  );
}
```

### Proposal Responses

```typescript
async respondToProposal(proposalId: string, status: 'APPROVED' | 'REJECTED') {
  const proposal = await this.prisma.sponsorshipProposal.update({
    where: { id: proposalId },
    data: { status },
    select: { userId: true },
  });

  await this.fcmService.sendPushNotification({
    userId: proposal.userId,
    title: status === 'APPROVED' ? 'Proposal Approved' : 'Proposal Declined',
    body: `Your proposal was ${status.toLowerCase()}`,
    type: 'sponsorship_proposal',
    interestId: proposalId,
  });
}
```

## Error Handling

### Invalid/Revoked Tokens

The FcmService automatically handles invalid tokens:

```typescript
try {
  await firebaseAdmin.messaging().send(message);
} catch (error) {
  if (error.code === 'messaging/invalid-registration-token' ||
      error.code === 'messaging/registration-token-not-registered') {
    // Token is no longer valid - clear it
    await this.prisma.user.update({
      where: { id: userId },
      data: { fcmToken: null },
    });
  }
}
```

### No Token Available

If a user hasn't saved their FCM token yet (e.g., on first app launch), the notification is silently skipped:

```typescript
const user = await this.prisma.user.findUnique({
  where: { id: userId },
  select: { fcmToken: true },
});

if (!user?.fcmToken) {
  return; // User hasn't saved token yet
}
```

## Testing

### Manual Testing

```bash
# 1. Start the backend
npm run start:dev

# 2. In another terminal, test with curl

# Save a test token to a user
curl -X POST http://localhost:3000/api/v1/users/fcm-token \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fcmToken": "test-token-123"}'

# 3. Verify it was saved
curl http://localhost:3000/api/v1/auth/me \
  -H "Authorization: Bearer YOUR_TOKEN"

# Response should include:
# {
#   "fcmToken": "test-token-123",
#   ...
# }
```

### Integration Testing

Create a test endpoint (optional) to send test notifications:

```typescript
@Post('test/send-notification')
@Roles('SUPER_ADMIN')
async sendTestNotification(
  @Body() { userId, title, body, type, threadId, interestId }: any
) {
  await this.fcmService.sendPushNotification({
    userId,
    title,
    body,
    type,
    threadId,
    interestId,
  });
  return { message: 'Test notification sent' };
}
```

## Database Schema

```sql
-- User table with fcmToken
CREATE TABLE users (
  id UUID PRIMARY KEY,
  firebaseUid VARCHAR UNIQUE NOT NULL,
  email VARCHAR,
  phone VARCHAR,
  firstName VARCHAR NOT NULL,
  lastName VARCHAR NOT NULL,
  avatarUrl VARCHAR,
  gender VARCHAR,
  isActive BOOLEAN DEFAULT true,
  mustCompleteProfile BOOLEAN DEFAULT false,
  deletedAt TIMESTAMP,
  roleId UUID NOT NULL,
  adminRoleId UUID,
  pendingAdminRoleId UUID,
  fcmToken TEXT, -- Firebase Cloud Messaging token
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (roleId) REFERENCES roles(id),
  FOREIGN KEY (adminRoleId) REFERENCES roles(id),
  FOREIGN KEY (pendingAdminRoleId) REFERENCES roles(id)
);

-- Query to find users with valid tokens
SELECT id, email, fcmToken FROM users WHERE fcmToken IS NOT NULL;

-- Clear all tokens (if needed during migration)
UPDATE users SET fcmToken = NULL;
```

## Deployment Checklist

- [ ] Database migration applied (`20261015180000_add_fcm_token_to_user`)
- [ ] Prisma client regenerated (`npx prisma generate`)
- [ ] `POST /users/fcm-token` endpoint tested
- [ ] FcmService integrated into relevant modules (chat, deals, proposals, etc.)
- [ ] Firebase Admin SDK initialized and credentials configured
- [ ] Error handling for invalid tokens verified
- [ ] Bulk notification sending tested
- [ ] Mobile app updated with notification routing (see FCM_TESTING_GUIDE.md in mobile app)
- [ ] Production Firebase project configured

## Troubleshooting

### Tokens not being saved
- Check that mobile app is calling `POST /users/fcm-token`
- Verify authentication token is valid
- Check database for user.fcmToken column

### Notifications not received
- Verify Firebase Admin SDK is initialized
- Check that user.fcmToken is not null
- Check Firebase console for delivery status
- Verify app has notification permissions on device

### "Invalid registration token" errors
- Token may have expired (happens after app reinstall)
- User may have revoked notification permissions
- Automatically handled - token is cleared from DB

## Security Considerations

- Tokens are sent via HTTPS only
- Tokens are tied to specific user accounts (stored in `users.fcmToken`)
- Firebase Admin SDK uses service account credentials (secure)
- No sensitive data in notification payload (only routing info)
- Invalid tokens are automatically cleaned up
