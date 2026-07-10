import { IsArray, IsEnum, IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { VibeType, SocialStyle, InterestAffinity } from '@prisma/client';

export class InterestAffinityInputDto {
  @IsUUID('4')
  interestId: string;

  @IsEnum(InterestAffinity)
  affinity: InterestAffinity;
}

export class VibeMatchDto {
  @ApiPropertyOptional({ enum: VibeType })
  @IsOptional()
  @IsEnum(VibeType)
  vibeType?: VibeType;

  @ApiPropertyOptional({ enum: SocialStyle })
  @IsOptional()
  @IsEnum(SocialStyle)
  socialStyle?: SocialStyle;

  @ApiPropertyOptional({
    type: [InterestAffinityInputDto],
    description: 'Interest IDs with your affinity for each (LIKED / DISLIKED / OPEN_TO)',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InterestAffinityInputDto)
  interests?: InterestAffinityInputDto[];
}
