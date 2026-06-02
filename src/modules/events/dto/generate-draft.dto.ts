import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class GenerateDraftDto {
  @ApiProperty({
    description: 'Natural language description of the event for the AI copilot to generate a draft from.',
    minLength: 20,
    maxLength: 2000,
    example: 'Create a rooftop nightlife event in Kolkata for young professionals with DJ, cocktails, and sunset vibes.',
  })
  @IsString()
  @MinLength(20, { message: 'Prompt must be at least 20 characters' })
  @MaxLength(2000, { message: 'Prompt must not exceed 2000 characters' })
  prompt: string;
}
