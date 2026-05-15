import { PartialType } from '@nestjs/swagger';
import { CreateAttendeeProfileDto } from './create-attendee-profile.dto';

export class UpdateAttendeeProfileDto extends PartialType(CreateAttendeeProfileDto) {}
