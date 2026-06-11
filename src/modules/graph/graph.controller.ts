import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { InternalApiKeyGuard } from '../../common/guards/internal-api-key.guard';
import { GraphService } from './graph.service';

@ApiTags('Graph')
@Controller('graph')
export class GraphController {
  constructor(private readonly graphService: GraphService) {}

  // ─── Internal endpoints (X-API-Key) — debugging & ops only ─────────────────

  @Get('internal/users/:id/connections')
  @Public()
  @UseGuards(InternalApiKeyGuard)
  @ApiExcludeEndpoint()
  getUserConnections(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit?: string,
  ) {
    return this.graphService.getConnections(id, limit ? Number(limit) : undefined);
  }

  @Post('internal/events/:id/recompute')
  @Public()
  @UseGuards(InternalApiKeyGuard)
  @ApiExcludeEndpoint()
  recomputeEventEdges(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { notify?: boolean },
  ) {
    return this.graphService.recomputeEdgesForEvent(id, body?.notify ?? false);
  }
}
