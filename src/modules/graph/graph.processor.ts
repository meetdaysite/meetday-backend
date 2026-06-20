import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { GraphService } from './graph.service';

@Processor('graph')
export class GraphProcessor {
  private readonly logger = new Logger(GraphProcessor.name);

  constructor(private readonly graphService: GraphService) {}

  @Process('recompute-event-edges')
  async handleRecomputeEventEdges(job: Job<{ eventId: string; notify?: boolean }>) {
    const { eventId, notify } = job.data;
    const { participants } = await this.graphService.recomputeEdgesForEvent(eventId, notify ?? false);
    this.logger.log(`Computed edges for event ${eventId} (${participants} participant(s))`);
  }
}
