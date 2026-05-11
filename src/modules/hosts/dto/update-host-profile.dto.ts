import { PartialType } from '@nestjs/swagger';
import { ApplyHostDto } from './apply-host.dto';

export class UpdateHostProfileDto extends PartialType(ApplyHostDto) {}
