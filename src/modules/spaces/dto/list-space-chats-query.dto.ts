import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SpaceChatStatus } from '@prisma/client';

export class ListSpaceChatsQueryDto {
  @ApiPropertyOptional({ enum: SpaceChatStatus, description: 'Filter by REQUESTED, ACCEPTED, or DECLINED. Omit for all.' })
  @IsOptional()
  @IsEnum(SpaceChatStatus)
  status?: SpaceChatStatus;

  @ApiPropertyOptional({
    description:
      'Which "hat" to list threads as, when the same account holds more than one relevant profile ' +
      '(rare). BRAND / COMMUNITY / SPACE.',
  })
  @IsOptional()
  @IsString()
  role?: 'BRAND' | 'COMMUNITY' | 'SPACE';
}
