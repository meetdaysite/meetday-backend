import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { MeetdayChatService } from './meetday-chat.service';
import { SendChatMessageDto } from '../sponsorship/dto/send-chat-message.dto';

@ApiTags('Meetday Chat')
@ApiBearerAuth('firebase-token')
@UseGuards(RolesGuard)
@Roles('HOST', 'BRAND')
@Controller('meetday-chat')
export class MeetdayChatController {
  constructor(private readonly meetdayChatService: MeetdayChatService) {}

  @Get('messages')
  @ApiOperation({
    summary: 'Get my "Talk to Meetday" support chat',
    description: 'Returns (and lazily creates) my own thread with the Meetday team, oldest message first.',
  })
  @ApiOkResponse({ description: 'Messages, oldest first.' })
  getMyChat(@GetUser('id') userId: string) {
    return this.meetdayChatService.getMyChat(userId);
  }

  @Post('messages')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Send a message to Meetday' })
  @ApiOkResponse({ description: 'Message sent.' })
  sendMyMessage(@GetUser('id') userId: string, @Body() dto: SendChatMessageDto) {
    return this.meetdayChatService.sendMyMessage(userId, dto);
  }
}
