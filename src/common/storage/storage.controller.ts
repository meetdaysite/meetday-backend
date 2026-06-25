import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StorageService } from './storage.service';
import { RequestUploadUrlDto } from './dto/request-upload-url.dto';
import { GetUser } from '../decorators/get-user.decorator';

@ApiTags('Storage')
@ApiBearerAuth('firebase-token')
@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Post('upload-url')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request a presigned S3 upload URL',
    description: `Returns a presigned **PUT** URL (valid 15 min) and the S3 key.
Upload the file directly to S3 with a \`PUT\` using the **matching \`Content-Type\` header**, then include the returned \`key\` in the relevant resource body.

Each context narrows which \`contentType\` is accepted and who may upload. \`resourceId\` is the UUID of the related resource. Mismatches return \`400\`; insufficient role/ownership returns \`403\`.

| context | resourceId | allowed contentType | who can upload |
|---|---|---|---|
| \`EVENT_MEDIA\` | event UUID *(optional)* | image/*, video/mp4 | Host who owns the event (or any host, pre-creation). \`mediaType\` (COVER/GALLERY/VIDEO) required. |
| \`USER_AVATAR\` | — | image/* | Any authenticated user (own folder) |
| \`HOST_DOCUMENT\` | — | image/*, **application/pdf** | User with a host profile |
| \`INTEREST_IMAGE\` | interest UUID | image/* | **SUPER_ADMIN** |
| \`REVIEW_PHOTO\` | — | image/* | Any authenticated user (own folder) |
| \`COMMUNITY_COVER\` | community UUID *(optional)* | image/* | **SUPER_ADMIN / CITY_ADMIN** |
| \`COMMUNITY_ICON\` | community UUID *(optional)* | image/* | **SUPER_ADMIN / CITY_ADMIN** |
| \`COMMUNITY_ANNOUNCEMENT\` | community UUID | image/* | **SUPER_ADMIN / CITY_ADMIN** |
| \`COMMUNITY_DM_MEDIA\` | conversation UUID | image/* | A participant of an \`ACCEPTED\` DM conversation |
| \`COMMUNITY_FEED_MEDIA\` | community UUID | image/*, video/mp4 | An \`ACTIVE\` member of the community |

*image/* = \`image/jpeg\`, \`image/png\`, \`image/webp\`.*

**S3 key paths**
- \`EVENT_MEDIA\` → \`events/{eventId}/{mediaType}/{uuid}.ext\` (or \`hosts/{hostProfileId}/event-media/{mediaType}/{uuid}.ext\` pre-creation)
- \`USER_AVATAR\` → \`users/{userId}/avatar/{uuid}.ext\`
- \`HOST_DOCUMENT\` → \`hosts/{hostProfileId}/documents/{uuid}.ext\`
- \`INTEREST_IMAGE\` → \`interests/{interestId}/{uuid}.ext\`
- \`REVIEW_PHOTO\` → \`users/{userId}/review-photos/{uuid}.ext\`
- \`COMMUNITY_COVER\`/\`COMMUNITY_ICON\` → \`communities/{communityId}/{cover|icon}/{uuid}.ext\` (or \`admins/{userId}/community-media/{folder}/{uuid}.ext\` pre-creation)
- \`COMMUNITY_ANNOUNCEMENT\` → \`communities/{communityId}/announcements/{uuid}.ext\`
- \`COMMUNITY_DM_MEDIA\` → \`community-dms/{conversationId}/{uuid}.ext\`
- \`COMMUNITY_FEED_MEDIA\` → \`communities/{communityId}/feed/{uuid}.ext\``,
  })
  @ApiOkResponse({ description: 'Presigned upload URL and key.' })
  requestUploadUrl(@GetUser('uid') firebaseUid: string, @Body() dto: RequestUploadUrlDto) {
    return this.storageService.requestUploadUrl(firebaseUid, dto);
  }
}
