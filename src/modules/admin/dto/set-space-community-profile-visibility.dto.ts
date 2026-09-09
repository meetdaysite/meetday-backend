import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetSpaceCommunityProfileVisibilityDto {
  @ApiProperty({ description: 'true to hide this space from brand/community browse/discovery, false to unhide' })
  @IsBoolean()
  isHidden: boolean;
}
