import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetMemberPermissionDto {
  @ApiProperty({ description: 'Whether this member can invite/remove other members (owner always can).' })
  @IsBoolean()
  canManageMembers: boolean;
}
