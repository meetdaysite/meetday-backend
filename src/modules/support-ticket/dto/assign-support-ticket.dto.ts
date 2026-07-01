import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignSupportTicketDto {
  @ApiProperty({
    example: 'adm1-uuid-0000-0000-000000000001',
    description:
      'UUID of the admin user to assign this ticket to. ' +
      'The ticket status is automatically set to IN_PROGRESS on assignment. ' +
      'Re-assigning an IN_PROGRESS ticket to a different admin is permitted.',
  })
  @IsUUID()
  adminUserId: string;
}
