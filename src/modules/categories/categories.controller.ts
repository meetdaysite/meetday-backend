import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('Categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'List active experience categories',
    description:
      'Returns all active experience categories. No authentication required. ' +
      'Used to populate category selection during host registration or profile update.',
  })
  @ApiOkResponse({
    description: 'List of active categories.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-05-07T10:00:00.000Z',
        data: [
          { id: 'cat-uuid-1', name: 'Food & Drink', description: 'Dining experiences and culinary workshops' },
          { id: 'cat-uuid-2', name: 'Outdoor Adventures', description: 'Hiking, trekking, and nature walks' },
        ],
      },
    },
  })
  list() {
    return this.categoriesService.listPublic();
  }
}
