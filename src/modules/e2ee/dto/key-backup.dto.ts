import { ApiProperty } from '@nestjs/swagger';
import { IsObject, IsString, MaxLength, MinLength } from 'class-validator';

export class PutKeyBackupDto {
  @ApiProperty({ description: 'Passphrase-wrapped master key (opaque base64)' })
  @IsString()
  @MinLength(1)
  @MaxLength(8192)
  wrappedMasterKey: string;

  @ApiProperty({
    description: 'Non-secret KDF parameters used to derive the wrapping key',
    example: { algo: 'argon2id', salt: '<base64>', ops: 3, mem: 67108864 },
  })
  @IsObject()
  kdfParams: Record<string, unknown>;
}
