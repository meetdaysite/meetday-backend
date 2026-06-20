import { IsArray, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetCommunityInterestsDto {
  @ApiProperty({ type: [String], description: 'Interest UUIDs. Replaces the full set of community interests.' })
  @IsArray()
  @IsUUID('4', { each: true })
  interestIds: string[];
}
