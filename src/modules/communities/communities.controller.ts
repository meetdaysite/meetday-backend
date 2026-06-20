import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { OptionalAuthGuard } from '../../common/guards/optional-auth.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { CommunitiesService } from './communities.service';
import { ListCommunitiesQueryDto } from './dto/list-communities-query.dto';

@ApiTags('Communities')
@ApiBearerAuth('firebase-token')
@Controller('communities')
export class CommunitiesController {
  constructor(private readonly communitiesService: CommunitiesService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Browse published communities' })
  @ApiOkResponse({ description: 'Paginated list of discoverable communities.' })
  browse(@Query() query: ListCommunitiesQueryDto) {
    return this.communitiesService.listPublic(query);
  }

  @Get(':slug')
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({ summary: 'Get a published community by slug' })
  findBySlug(@Param('slug') slug: string) {
    return this.communitiesService.findBySlug(slug);
  }

  @Post(':id/join')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Join a community (or request access)' })
  join(@Param('id', ParseUUIDPipe) id: string, @GetUser('uid') firebaseUid: string) {
    return this.communitiesService.join(id, firebaseUid);
  }
}
