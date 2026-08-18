import { IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SponsorshipChatStatus } from '@prisma/client';

export class ListSponsorshipChatsQueryDto {
  @ApiPropertyOptional({ enum: SponsorshipChatStatus, description: 'Filter by REQUESTED or ACCEPTED. Omit to get both.' })
  @IsOptional()
  @IsEnum(SponsorshipChatStatus)
  status?: SponsorshipChatStatus;
}
