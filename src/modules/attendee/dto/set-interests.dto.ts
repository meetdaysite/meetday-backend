import { ArrayMaxSize, IsArray, IsEnum, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { InterestAffinity } from '@prisma/client';

export class InterestAffinityItemDto {
  @ApiProperty({ description: 'Interest UUID (from GET /interests)' })
  @IsUUID('4')
  interestId: string;

  @ApiProperty({ enum: InterestAffinity, example: 'LIKED', description: 'How the user relates to this interest' })
  @IsEnum(InterestAffinity)
  affinity: InterestAffinity;
}

export class SetInterestsDto {
  @ApiProperty({
    type: [InterestAffinityItemDto],
    description: "Replaces the full set of the user's interest affinities.",
  })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => InterestAffinityItemDto)
  interests: InterestAffinityItemDto[];
}
