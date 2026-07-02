import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SupportTicketPriority } from '@prisma/client';

export class EscalateTicketDto {
  @ApiProperty({
    enum: SupportTicketPriority,
    example: 'URGENT',
    description:
      'New priority level. Admins may set any value including URGENT. ' +
      'URGENT should be reserved for active financial fraud or platform issues with immediate user impact.',
  })
  @IsEnum(SupportTicketPriority)
  priority: SupportTicketPriority;
}
