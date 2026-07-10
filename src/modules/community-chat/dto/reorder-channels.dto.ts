import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class ReorderChannelsDto {
  @ApiProperty({ type: [String], description: 'Channel IDs in desired order' })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  orderedIds: string[];
}
