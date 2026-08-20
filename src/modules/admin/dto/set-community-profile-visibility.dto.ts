import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetCommunityProfileVisibilityDto {
  @ApiProperty({ description: 'true to hide this community from brand browse/discovery, false to unhide' })
  @IsBoolean()
  isHidden: boolean;
}
