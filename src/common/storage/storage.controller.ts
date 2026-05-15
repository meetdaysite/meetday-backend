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
    description: `Returns a presigned PUT URL (valid 15 min) and the S3 key.
Upload the file directly to S3 using the PUT URL with the matching Content-Type header, then include the key in the relevant resource body.

**Contexts**

| context | resourceId | mediaType | Notes |
|---|---|---|---|
| \`EVENT_MEDIA\` | event UUID *(optional)* | required | If provided, must own the event. If omitted (pre-creation), must have a host profile — key is scoped to the host. |
| \`USER_AVATAR\` | — | — | Derived from JWT |
| \`HOST_DOCUMENT\` | — | — | Must have a host profile |
| \`INTEREST_IMAGE\` | interest UUID | — | Interest must exist. Intended for SUPER_ADMIN use. |

**Allowed contentType values:** \`image/jpeg\`, \`image/png\`, \`image/webp\`, \`video/mp4\`

**S3 key paths**
- \`EVENT_MEDIA\` (with resourceId) → \`events/{eventId}/{mediaType}/{uuid}.ext\`
- \`EVENT_MEDIA\` (without resourceId) → \`hosts/{hostProfileId}/event-media/{mediaType}/{uuid}.ext\`
- \`USER_AVATAR\` → \`users/{userId}/avatar/{uuid}.ext\`
- \`HOST_DOCUMENT\` → \`hosts/{hostProfileId}/documents/{uuid}.ext\`
- \`INTEREST_IMAGE\` → \`interests/{interestId}/{uuid}.ext\``,
  })
  @ApiOkResponse({ description: 'Presigned upload URL and key.' })
  requestUploadUrl(@GetUser('uid') firebaseUid: string, @Body() dto: RequestUploadUrlDto) {
    return this.storageService.requestUploadUrl(firebaseUid, dto);
  }
}
