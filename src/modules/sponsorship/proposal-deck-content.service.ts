import { Injectable, InternalServerErrorException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExpandProposalDeckContentDto } from './dto/expand-proposal-deck-content.dto';
import { ExpandProposalDeckContentResponseDto } from './dto/expand-proposal-deck-content-response.dto';

type AiDeckContentResponse = {
  value_proposition: string;
  campaign_overview: string;
  audience_reach: string;
  deliverables_expanded: string;
  timeline_expanded: string;
};

// Calls the meetday-ai microservice to expand a host's bare-bones "Generate Proposal PDF" form
// inputs into polished, brand-facing copy for a slide-deck-style pitch — mirrors
// ProposalCopilotService's calling convention (same AI server, same error handling).
@Injectable()
export class ProposalDeckContentService {
  private readonly logger = new Logger(ProposalDeckContentService.name);
  private readonly aiServerUrl: string;

  constructor(private readonly config: ConfigService) {
    this.aiServerUrl = this.config.get<string>('aiServerUrl')!;
  }

  async expandContent(dto: ExpandProposalDeckContentDto, hostId: string): Promise<ExpandProposalDeckContentResponseDto> {
    const url = `${this.aiServerUrl}/proposal-deck/expand-content`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host_id: hostId,
          sponsor_name: dto.sponsorName,
          event_title: dto.eventTitle,
          deliverables: dto.deliverables,
          timeline: dto.timeline,
          pricing_summary: dto.pricingTiers?.map((t) => `${t.name}: ${t.price}`).join(', '),
          terms: dto.terms,
        }),
      });
    } catch {
      this.logger.error(`AI server unreachable at ${url}`);
      throw new InternalServerErrorException('AI service is currently unavailable. Please try again later.');
    }

    const data = (await response.json()) as AiDeckContentResponse & { error?: string; detail?: string };

    if (!response.ok) {
      this.logger.error(`AI server returned ${response.status}: ${JSON.stringify(data)}`);

      if (data?.error === 'GEMINI_API_ERROR' || response.status === 502) {
        throw new ServiceUnavailableException('AI model is currently experiencing high demand. Please try again in a moment.');
      }

      throw new InternalServerErrorException('Failed to expand proposal content. Please try again.');
    }

    return {
      valueProposition: data.value_proposition,
      campaignOverview: data.campaign_overview,
      audienceReach: data.audience_reach,
      deliverablesExpanded: data.deliverables_expanded,
      timelineExpanded: data.timeline_expanded,
    };
  }
}
