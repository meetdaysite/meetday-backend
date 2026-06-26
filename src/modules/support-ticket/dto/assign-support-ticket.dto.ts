import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignSupportTicketDto {
  @ApiProperty({ description: 'Admin user ID to assign this ticket to' })
  @IsUUID()
  adminUserId: string;
}
