import { ApiProperty } from '@nestjs/swagger';
import { MemberProfileVisibility } from '@prisma/client';
import { Equals, IsBoolean, IsEnum } from 'class-validator';

export class JoinCommunityDto {
  @ApiProperty({
    enum: MemberProfileVisibility,
    default: MemberProfileVisibility.EVENT_ATTENDEES_ONLY,
    description:
      'How the member\'s profile appears to others inside this community. ' +
      'EVENT_ATTENDEES_ONLY — visible only to people attending the same events (recommended). ' +
      'COMMUNITY_MEMBERS — visible to all active members. ' +
      'PRIVATE — hidden until the member attends a community event.',
  })
  @IsEnum(MemberProfileVisibility)
  profileVisibility: MemberProfileVisibility;

  @ApiProperty({
    example: true,
    description: 'Must be true — the user has read and accepted the community guidelines.',
  })
  @IsBoolean()
  @Equals(true, { message: 'You must accept the community guidelines to join' })
  guidelinesAccepted: boolean;
}
