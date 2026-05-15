import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InterestsService } from './interests.service';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('Interests')
@Controller('interests')
export class InterestsController {
  constructor(private readonly interestsService: InterestsService) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'List all interests',
    description:
      'Returns all interests. No authentication required. ' +
      'Used to populate interest selection during attendee registration or profile update.',
  })
  @ApiOkResponse({
    description: 'List of interests.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-05-15T10:00:00.000Z',
        data: [
          { id: 'interest-uuid-1', name: 'Photography', slug: 'photography', description: 'Capture moments and explore visual storytelling', image: null },
          { id: 'interest-uuid-2', name: 'Food & Drink', slug: 'food-drink', description: 'Culinary experiences, food tours, and tastings', image: 'https://cdn.meetday.app/interests/food.jpg' },
        ],
      },
    },
  })
  list() {
    return this.interestsService.listPublic();
  }
}
