import { IsDateString, IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { SupportTicketCategory, SupportTicketPriority, SupportTicketStatus } from '@prisma/client';

export class ListSupportTicketsQueryDto {
  @ApiPropertyOptional({
    enum: SupportTicketStatus,
    example: 'OPEN',
    description: 'Filter by ticket status. OPEN = unassigned; IN_PROGRESS = assigned and being worked on; RESOLVED = resolution recorded; CLOSED = terminal state.',
  })
  @IsOptional()
  @IsEnum(SupportTicketStatus)
  status?: SupportTicketStatus;

  @ApiPropertyOptional({
    enum: SupportTicketPriority,
    example: 'HIGH',
    description: 'Filter by priority. Results are always ordered priority DESC then createdAt DESC, so this filter narrows to a single tier.',
  })
  @IsOptional()
  @IsEnum(SupportTicketPriority)
  priority?: SupportTicketPriority;

  @ApiPropertyOptional({
    enum: SupportTicketCategory,
    example: 'PAYMENT_ISSUE',
    description: 'Filter by category. Combine with priority=HIGH to surface the most urgent financial tickets.',
  })
  @IsOptional()
  @IsEnum(SupportTicketCategory)
  category?: SupportTicketCategory;

  @ApiPropertyOptional({
    example: 'adm1-uuid-0000-0000-000000000001',
    description: 'Filter by the UUID of the admin the ticket is assigned to. Use with status=IN_PROGRESS to view a specific agent\'s active queue.',
  })
  @IsOptional()
  @IsUUID()
  assignedTo?: string;

  @ApiPropertyOptional({
    example: '2026-07-01',
    description: 'Return only tickets created on or after this date (ISO 8601 date string, inclusive).',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-07-31',
    description: 'Return only tickets created on or before this date (ISO 8601 date string, inclusive).',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    minimum: 1,
    default: 1,
    example: 1,
    description: 'Page number (1-indexed).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 100,
    default: 20,
    example: 20,
    description: 'Number of tickets per page (1–100).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
