import { IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InviteTeamMemberDto {
  @ApiProperty({ example: 'teammate@example.com', description: 'Email address of the person to invite.' })
  @IsEmail()
  email: string;
}
