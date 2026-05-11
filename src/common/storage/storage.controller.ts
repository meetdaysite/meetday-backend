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
    description:
      'Returns a presigned PUT URL (valid 15 min) and the S3 key. ' +
      'Upload the file directly to S3 via PUT, then pass the key in the relevant resource body.',
  })
  @ApiOkResponse({ description: 'Presigned upload URL and key.' })
  requestUploadUrl(@GetUser('id') userId: string, @Body() dto: RequestUploadUrlDto) {
    return this.storageService.requestUploadUrl(userId, dto);
  }
}
