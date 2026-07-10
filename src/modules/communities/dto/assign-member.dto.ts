import { IsEnum, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CommunityRole } from '@prisma/client';

export class AssignMemberDto {
  @ApiProperty({ description: 'User UUID of the platform user to assign.' })
  @IsUUID('4')
  userId: string;

  @ApiProperty({ enum: CommunityRole, example: CommunityRole.MANAGER })
  @IsEnum(CommunityRole)
  role: CommunityRole;
}
