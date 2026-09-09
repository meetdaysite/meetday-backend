import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CategoryType } from '@prisma/client';
import { CategoriesService } from './categories.service';
import { Public } from '../../common/decorators/public.decorator';
import { InternalApiKeyGuard } from '../../common/guards/internal-api-key.guard';

@ApiTags('Categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'List active categories',
    description:
      'Returns all active categories of the given type (defaults to EXPERIENCE). No authentication required. ' +
      'Used to populate category selection during host/space registration or profile update.',
  })
  @ApiQuery({ name: 'type', enum: ['EXPERIENCE', 'SPACE'], required: false })
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
  list(@Query('type') type?: CategoryType) {
    return this.categoriesService.listPublic(type);
  }

  @Get('internal')
  @Public()
  @UseGuards(InternalApiKeyGuard)
  @ApiExcludeEndpoint()
  listInternal() {
    return this.categoriesService.listPublic();
  }
}
