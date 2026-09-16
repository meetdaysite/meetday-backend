# Community Collaboration Feature - Backend Setup

## Summary
Complete backend implementation for community-to-community collaboration feature with chat, requests, and messaging.

## Files Created

### 1. **Prisma Schema Updates**
**File:** `prisma/schema.prisma`

Added models:
- `CommunityCollaborationStatus` enum
- `CommunityCollaborationInterest` model
- `CommunityCollaborationMessage` model
- Updated `HostCommunityProfile` with collaboration relationships
- Updated `User` model with collaboration message relation

### 2. **NestJS Module - Community Collaboration**

#### A. Service (`src/modules/community-collaboration/community-collaboration.service.ts`)
Methods implemented:
- `markCollaborationInterest()` - Send collaboration request
- `getMyCommunityCollaborationChats()` - Get all collaboration chats (with status filter)
- `getCommunityCollaborationChatMessages()` - Get messages in a collaboration chat
- `acceptCollaborationRequest()` - Accept incoming request
- `declineCollaborationRequest()` - Decline incoming request
- `sendCollaborationMessage()` - Send message in collaboration chat
- `getCommunityCollaborationChatByPartner()` - Check if chat exists with partner

#### B. Controller (`src/modules/community-collaboration/community-collaboration.controller.ts`)
Routes:
```
POST   /community-collaboration/interest/:targetCommunityId
GET    /community-collaboration/chats?status=REQUESTED|ACCEPTED
GET    /community-collaboration/chats/:interestId/messages
POST   /community-collaboration/chats/:interestId/accept
POST   /community-collaboration/chats/:interestId/decline
POST   /community-collaboration/chats/:interestId/messages
GET    /community-collaboration/chats/partner/:partnerId
```

#### C. DTOs (`src/modules/community-collaboration/dto/`)
- `CreateCollaborationMessageDto` - Message payload

#### D. Module (`src/modules/community-collaboration/community-collaboration.module.ts`)
- Exports service for use in other modules
- Uses PrismaModule for database access

## App Module Integration
**File:** `src/app.module.ts`

Added:
- Import statement for `CommunityCollaborationModule`
- Module added to imports array

## Next Steps

### 1. Database Migration
```bash
# Reset shadow database if needed (only in development)
npx prisma migrate reset --force

# Or apply pending migrations
npx prisma migrate deploy

# Generate Prisma client
npx prisma generate
```

### 2. Authentication Integration
Update the controller to properly extract `communityId` from JWT. The current implementation assumes:
- `req.user.communityId` - The authenticated user's community ID
- `req.user.id` - The authenticated user's ID

Adjust based on your JWT payload structure.

### 3. Testing
Create integration tests:
- Test collaboration request flow (send, accept, decline)
- Test messaging with different statuses
- Test validation (only target can accept, only accepted chats can message, etc.)
- Test partner chat detection

### 4. WebSocket/Real-time Updates (Optional)
Consider adding WebSocket events for:
- New collaboration request notification
- New message in collaboration chat
- Request accepted/declined notification

## Database Schema

### CommunityCollaborationInterest
```sql
- id: UUID (primary key)
- requesterCommunityId: UUID (FK to HostCommunityProfile)
- targetCommunityId: UUID (FK to HostCommunityProfile)
- message: TEXT (optional)
- chatStatus: ENUM (REQUESTED, ACCEPTED, DECLINED)
- chatAcceptedAt: DateTime
- lastMessageAt: DateTime
- requesterLastReadAt: DateTime
- targetLastReadAt: DateTime
- adminLastReadAt: DateTime
- createdAt: DateTime
```

### CommunityCollaborationMessage
```sql
- id: UUID (primary key)
- communityCollaborationId: UUID (FK)
- senderType: String (REQUESTER, TARGET)
- senderId: UUID (FK to User)
- messageType: ENUM (TEXT, etc.)
- content: TEXT
- mediaKey: String (optional)
- replyToId: UUID (optional, self-referencing)
- deletedAt: DateTime (soft delete)
- createdAt: DateTime
```

## Business Logic

1. **Prevent duplicate requests**: Unique constraint on (requesterCommunityId, targetCommunityId)
2. **Self-collaboration blocked**: Cannot collaborate with own community
3. **Messaging rules**: Only ACCEPTED chats can receive messages
4. **Request authorization**: Only target community can accept/decline
5. **Soft delete**: Messages are soft-deleted for audit trail

## Integration Points

- Frontend: Already has API functions and UI components
- Notifications: Add listeners for collaboration requests/messages (if WebSocket added)
- Chat Gateway: Can extend to support real-time collaboration chat (optional)

## Error Handling

The service throws:
- `BadRequestException` - Invalid operations (self-collaboration, wrong status)
- `NotFoundException` - Collaboration chat or request not found

Controller guards with `@UseGuards(AuthGuard('jwt'))` ensure authentication.

## Notes

- No "Lock the Deal" functionality - this is communication-only
- Messages follow the same reply/media pattern as SpaceHostChat
- Read tracking via `requesterLastReadAt` and `targetLastReadAt`
