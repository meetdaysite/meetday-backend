import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SpaceHostChatStatus } from '@prisma/client';

export class ListSpaceHostChatsQueryDto {
  @ApiPropertyOptional({ enum: SpaceHostChatStatus, description: 'Filter by REQUESTED, ACCEPTED, or DECLINED. Omit for all.' })
  @IsOptional()
  @IsEnum(SpaceHostChatStatus)
  status?: SpaceHostChatStatus;

  @ApiPropertyOptional({
    enum: ['HOST', 'SPACE'],
    description: 'Which "hat" to list threads as, when the same account holds both a Host and a Space profile (rare).',
  })
  @IsOptional()
  @IsString()
  role?: 'HOST' | 'SPACE';
}
