import {
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AgeRange, Gender, ProfileVisibility, SocialStyle, VibeType } from '@prisma/client';

export class CreateAttendeeProfileDto {
  @ApiPropertyOptional({
    minLength: 3,
    maxLength: 30,
    example: 'rahul_walks',
    description: 'Unique username. Lowercase letters, numbers, and underscores only.',
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[a-z0-9_]+$/, { message: 'username may only contain lowercase letters, numbers, and underscores' })
  username?: string;

  @ApiPropertyOptional({ maxLength: 300, example: 'I love outdoor events and coffee meetups.' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  bio?: string;

  @ApiPropertyOptional({ example: 'Mumbai' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ enum: AgeRange, example: 'AGE_25_34' })
  @IsOptional()
  @IsEnum(AgeRange)
  ageRange?: AgeRange;

  @ApiPropertyOptional({
    enum: Gender,
    example: 'PREFER_NOT_TO_SAY',
    description: 'Optional self-identified gender. Used only for aggregate audience demographics — never surfaced individually.',
  })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional({ maxLength: 100, example: 'Product Designer' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  profession?: string;

  @ApiPropertyOptional({ enum: VibeType, example: 'HERE_TO_CONNECT' })
  @IsOptional()
  @IsEnum(VibeType)
  vibeType?: VibeType;

  @ApiPropertyOptional({ enum: SocialStyle, example: 'OPEN_TO_MEETING' })
  @IsOptional()
  @IsEnum(SocialStyle)
  socialStyle?: SocialStyle;

  @ApiPropertyOptional({ enum: ProfileVisibility, default: 'MEMBERS_ONLY' })
  @IsOptional()
  @IsEnum(ProfileVisibility)
  privacy?: ProfileVisibility;

}
