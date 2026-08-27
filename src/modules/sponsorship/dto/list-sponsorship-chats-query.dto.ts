import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SponsorshipChatStatus } from '@prisma/client';

export class ListSponsorshipChatsQueryDto {
  @ApiPropertyOptional({ enum: SponsorshipChatStatus, description: 'Filter by REQUESTED or ACCEPTED. Omit to get both.' })
  @IsOptional()
  @IsEnum(SponsorshipChatStatus)
  status?: SponsorshipChatStatus;

  @ApiPropertyOptional({ description: 'Filter/context by role: HOST or BRAND.' })
  @IsOptional()
  @IsString()
  role?: 'HOST' | 'BRAND';

  @ApiPropertyOptional({ description: 'Filter by type: SPONSORSHIP or CAMPAIGN.' })
  @IsOptional()
  @IsString()
  type?: 'SPONSORSHIP' | 'CAMPAIGN';
}
