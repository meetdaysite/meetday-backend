import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { E2eeService } from './e2ee.service';
import { PutKeyBackupDto } from './dto/key-backup.dto';
import { RegisterDeviceDto } from './dto/register-device.dto';

@ApiTags('E2EE Keys')
@ApiBearerAuth('firebase-token')
@Controller('me')
export class E2eeController {
  constructor(private readonly e2ee: E2eeService) {}

  @Post('devices')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Register / re-publish a device public key (idempotent)' })
  registerDevice(@GetUser('uid') firebaseUid: string, @Body() dto: RegisterDeviceDto) {
    return this.e2ee.registerDevice(firebaseUid, dto);
  }

  @Get('devices')
  @ApiOperation({ summary: 'List my registered devices' })
  listDevices(@GetUser('uid') firebaseUid: string) {
    return this.e2ee.listMyDevices(firebaseUid);
  }

  @Delete('devices/:deviceId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a device (sets revokedAt)' })
  revokeDevice(@GetUser('uid') firebaseUid: string, @Param('deviceId') deviceId: string) {
    return this.e2ee.revokeDevice(firebaseUid, deviceId);
  }

  @Put('key-backup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Store/replace the passphrase-wrapped master key backup' })
  putKeyBackup(@GetUser('uid') firebaseUid: string, @Body() dto: PutKeyBackupDto) {
    return this.e2ee.putKeyBackup(firebaseUid, dto);
  }

  @Get('key-backup')
  @ApiOperation({ summary: 'Fetch my encrypted key backup (for restore on a new device)' })
  getKeyBackup(@GetUser('uid') firebaseUid: string) {
    return this.e2ee.getKeyBackup(firebaseUid);
  }

  @Get('dm-key-wrap-requests')
  @ApiOperation({ summary: 'Conversations missing a key wrap for one of my devices (provisioning)' })
  dmKeyWrapRequests(@GetUser('uid') firebaseUid: string) {
    return this.e2ee.listDmKeyWrapRequests(firebaseUid);
  }
}

