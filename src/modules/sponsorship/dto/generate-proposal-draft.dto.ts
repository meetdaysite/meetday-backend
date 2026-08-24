import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class GenerateProposalDraftDto {
  @ApiProperty({
    description: 'Natural language description of the sponsorship opportunity for the AI copilot to generate a draft from. May include text extracted from an uploaded document as extra context.',
    minLength: 20,
    maxLength: 8000,
    example: 'We run a monthly rooftop networking meetup for startup founders in Bangalore, around 200 people attend each time.',
  })
  @IsString()
  @MinLength(20, { message: 'Prompt must be at least 20 characters' })
  @MaxLength(8000, { message: 'Prompt must not exceed 8000 characters' })
  prompt: string;
}
