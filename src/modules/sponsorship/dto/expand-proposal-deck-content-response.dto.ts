import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ExpandProposalDeckContentResponseDto {
  @ApiProperty({ example: 'Sponsoring Night Rituals puts your brand in front of an engaged, in-person audience...' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  valueProposition: string;

  @ApiProperty({ example: 'Night Rituals is a monthly music showcase bringing together...' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  campaignOverview: string;

  @ApiProperty({ example: 'Expect a crowd of music enthusiasts and young professionals...' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  audienceReach: string;

  @ApiProperty({ example: 'Your brand will be featured on the main stage banner...' })
  @IsString()
  @MinLength(1)
  @MaxLength(3000)
  deliverablesExpanded: string;

  @ApiProperty({ example: 'The campaign kicks off October 1st and runs through November 15th...' })
  @IsString()
  @MinLength(1)
  @MaxLength(1500)
  timelineExpanded: string;
}
