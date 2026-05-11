import { IsEnum, IsString, Matches, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export enum BankAccountType {
  SAVINGS = 'SAVINGS',
  CURRENT = 'CURRENT',
}

export class BankAccountDto {
  @ApiProperty({
    description: 'Bank account number — passed to Razorpay for penny drop; never stored raw',
    example: '1234567890',
  })
  @IsString()
  @Matches(/^\d{9,18}$/, { message: 'Account number must be 9–18 digits' })
  accountNumber: string;

  @ApiProperty({
    description: 'IFSC code of the bank branch',
    example: 'HDFC0001234',
  })
  @IsString()
  @Matches(/^[A-Z]{4}0[A-Z0-9]{6}$/, { message: 'IFSC must be in format ABCD0123456' })
  ifscCode: string;

  @ApiProperty({
    description: 'Name of the account holder as registered with the bank',
    example: 'Rahul Sharma',
  })
  @IsString()
  accountHolderName: string;

  @ApiProperty({
    enum: BankAccountType,
    description: 'Bank account type',
    example: 'SAVINGS',
  })
  @IsEnum(BankAccountType)
  accountType: BankAccountType;
}

export class SubmitKycDto {
  @ApiProperty({
    type: BankAccountDto,
    description: 'Bank account details for penny drop verification. Account number is never stored raw.',
  })
  @ValidateNested()
  @Type(() => BankAccountDto)
  bankAccount: BankAccountDto;
}
