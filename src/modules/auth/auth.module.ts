import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import * as firebaseAdmin from 'firebase-admin';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ConsentModule } from '../consent/consent.module';
import { TeamAccessModule } from '../../common/team-access/team-access.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [ConsentModule, BullModule.registerQueue({ name: 'mail' }), TeamAccessModule, NotificationsModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {
  constructor(private readonly configService: ConfigService) {
    if (!firebaseAdmin.apps.length) {
      firebaseAdmin.initializeApp({
        credential: firebaseAdmin.credential.cert({
          projectId: this.configService.get<string>('firebase.projectId'),
          clientEmail: this.configService.get<string>('firebase.clientEmail'),
          privateKey: this.configService.get<string>('firebase.privateKey'),
        }),
      });
    }
  }
}
