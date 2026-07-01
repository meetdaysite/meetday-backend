import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SupportTicketCategory, SupportTicketPriority } from '@prisma/client';

export enum SupportTicketEntityType {
  USER = 'USER',
  HOST = 'HOST',
  EVENT = 'EVENT',
  ORDER = 'ORDER',
  COMMUNITY = 'COMMUNITY',
}

export class CreateSupportTicketDto {
  @ApiProperty({
    minLength: 5,
    maxLength: 150,
    example: 'Payment deducted but ticket not confirmed',
    description: 'Short, descriptive title for the ticket (5–150 characters).',
  })
  @IsString()
  @MinLength(5)
  @MaxLength(150)
  subject: string;

  @ApiProperty({
    minLength: 10,
    maxLength: 5000,
    example:
      'I completed the payment of ₹499 for Jazz Night at Koramangala but my ticket still shows as pending. ' +
      'The amount was debited from my UPI account (Ref: UPI20260701XXXX). Please check and issue the ticket or initiate a refund.',
    description: 'Detailed description of the issue (10–5000 characters).',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  body: string;

  @ApiProperty({
    enum: SupportTicketCategory,
    example: 'PAYMENT_ISSUE',
    description:
      'Category that classifies the issue. ' +
      'PAYMENT_ISSUE and REFUND_REQUEST always warrant HIGH priority. ' +
      'HOST_ISSUE warrants HIGH because it affects host revenue. ' +
      'EVENT_ISSUE, ACCOUNT_ISSUE, and COMMUNITY_ISSUE default to NORMAL. ' +
      'OTHER defaults to LOW.',
  })
  @IsEnum(SupportTicketCategory)
  category: SupportTicketCategory;

  @ApiPropertyOptional({
    enum: SupportTicketPriority,
    example: 'HIGH',
    description:
      'Explicit priority override. Omit to let the DB default to NORMAL. ' +
      'Apply the following hierarchy:\n' +
      '• HIGH — category is PAYMENT_ISSUE, REFUND_REQUEST, or HOST_ISSUE; ' +
      'OR any category when entityType = ORDER or HOST.\n' +
      '• NORMAL — category is ACCOUNT_ISSUE, EVENT_ISSUE, or COMMUNITY_ISSUE; ' +
      'OR entityType is USER, EVENT, or COMMUNITY.\n' +
      '• LOW — category is OTHER with no linked entityId.\n' +
      '• URGENT — admin-only escalation; do NOT set at creation.',
  })
  @IsOptional()
  @IsEnum(SupportTicketPriority)
  priority?: SupportTicketPriority;

  @ApiPropertyOptional({
    enum: SupportTicketEntityType,
    example: SupportTicketEntityType.ORDER,
    description:
      'Type of the entity this ticket relates to. ' +
      'ORDER or HOST unconditionally raise the priority floor to HIGH regardless of category. ' +
      'Used by admins to deep-link directly into the relevant record.',
  })
  @IsOptional()
  @IsEnum(SupportTicketEntityType)
  entityType?: SupportTicketEntityType;

  @ApiPropertyOptional({
    example: 'd4f3e2a1-9c1b-4e8a-b3f0-1a2b3c4d5e6f',
    description: 'UUID of the related entity (order, event, user, host, or community). Required when entityType is provided.',
  })
  @IsOptional()
  @IsUUID()
  entityId?: string;
}
