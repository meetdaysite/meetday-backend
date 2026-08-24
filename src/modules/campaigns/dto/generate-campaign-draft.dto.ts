import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class GenerateCampaignDraftDto {
  @ApiProperty({
    description: 'Natural language description of the campaign for the AI copilot to generate a draft from. May include text extracted from an uploaded document as extra context.',
    minLength: 20,
    maxLength: 8000,
    example: 'We want to sample our new energy drink at rooftop networking meetups for young professionals in Bangalore and Mumbai over the next quarter.',
  })
  @IsString()
  @MinLength(20, { message: 'Prompt must be at least 20 characters' })
  @MaxLength(8000, { message: 'Prompt must not exceed 8000 characters' })
  prompt: string;
}
