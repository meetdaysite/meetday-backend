import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AttendeeService } from './attendee.service';
import { CreateAttendeeProfileDto } from './dto/create-attendee-profile.dto';
import { UpdateAttendeeProfileDto } from './dto/update-attendee-profile.dto';
import { SetInterestsDto } from './dto/set-interests.dto';
import { GetUser } from '../../common/decorators/get-user.decorator';

@ApiTags('Attendee')
@ApiBearerAuth('firebase-token')
@Controller('attendee')
export class AttendeeController {
  constructor(private readonly attendeeService: AttendeeService) {}

  @Post('profile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create or update attendee profile' })
  @ApiOkResponse({ description: 'Attendee profile.' })
  createProfile(@GetUser('uid') firebaseUid: string, @Body() dto: CreateAttendeeProfileDto) {
    return this.attendeeService.createProfile(firebaseUid, dto);
  }

  @Get('profile/me')
  @ApiOperation({ summary: 'Get own attendee profile' })
  @ApiOkResponse({ description: 'Attendee profile.' })
  getOwnProfile(@GetUser('uid') firebaseUid: string) {
    return this.attendeeService.getOwnProfile(firebaseUid);
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Update attendee profile' })
  @ApiOkResponse({ description: 'Updated attendee profile.' })
  updateProfile(@GetUser('uid') firebaseUid: string, @Body() dto: UpdateAttendeeProfileDto) {
    return this.attendeeService.updateProfile(firebaseUid, dto);
  }

  @Get('interests')
  @ApiOperation({ summary: "Get the authenticated user's interests and affinities" })
  @ApiOkResponse({ description: "List of the user's interests with their affinity." })
  getInterests(@GetUser('uid') firebaseUid: string) {
    return this.attendeeService.getInterests(firebaseUid);
  }

  @Put('interests')
  @ApiOperation({ summary: "Replace the authenticated user's interest affinities" })
  @ApiOkResponse({ description: "Updated list of the user's interests." })
  setInterests(@GetUser('uid') firebaseUid: string, @Body() dto: SetInterestsDto) {
    return this.attendeeService.setInterests(firebaseUid, dto);
  }
}
