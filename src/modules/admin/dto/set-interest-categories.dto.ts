import { IsArray, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetInterestCategoriesDto {
  @ApiProperty({ type: [String], description: 'Category UUIDs to map to this interest. Duplicates are ignored.' })
  @IsArray()
  @IsUUID('4', { each: true })
  categoryIds: string[];
}
