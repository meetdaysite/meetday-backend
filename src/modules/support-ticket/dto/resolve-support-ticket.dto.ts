import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResolveSupportTicketDto {
  @ApiProperty({
    minLength: 10,
    maxLength: 2000,
    example:
      'We verified the UPI transaction (Ref: UPI20260701XXXX) and confirmed the debit was successful. ' +
      'A fresh event ticket has been issued and emailed to the reporter. ' +
      'If the confirmation email does not arrive within 30 minutes please reply to this ticket.',
    description:
      'Human-readable resolution note (10–2000 characters). ' +
      'Should describe: (1) the root cause or finding, (2) the action taken, and (3) any follow-up the reporter should expect. ' +
      'This text is stored on the ticket and may be surfaced to the reporter.',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  resolution: string;
}
