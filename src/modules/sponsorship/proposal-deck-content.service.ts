import { Injectable, InternalServerErrorException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GenerateProposalDeckPlanDto, GenerateProposalDeckPlanResponseDto } from './dto/generate-proposal-deck-plan.dto';
import { DeckSlideDto } from './dto/deck-slide.dto';

type AiDeckStat = { label: string; value: string };
type AiMiddleSlide = {
  layout: 'VALUE_PROP' | 'STAT_HIGHLIGHT' | 'BULLET_LIST';
  title: string;
  body: string;
  bullets: string[];
  stats: AiDeckStat[];
};
type AiDeckPlanResponse = {
  middle_slides: AiMiddleSlide[];
  closing_message: string;
};

// Calls the meetday-ai microservice to plan a proposal's pitch-deck content — the AI writes/
// elaborates copy and picks a layout per "middle" content slide, while the cover, pricing, and
// closing slides are assembled deterministically here from the proposal's own structured data.
// Mirrors ProposalCopilotService's calling convention (same AI server, same error handling).
@Injectable()
export class ProposalDeckContentService {
  private readonly logger = new Logger(ProposalDeckContentService.name);
  private readonly aiServerUrl: string;

  constructor(private readonly config: ConfigService) {
    this.aiServerUrl = this.config.get<string>('aiServerUrl')!;
  }

  async generatePlan(dto: GenerateProposalDeckPlanDto, hostId: string): Promise<GenerateProposalDeckPlanResponseDto> {
    const url = `${this.aiServerUrl}/proposal-deck/plan`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host_id: hostId,
          event_name: dto.eventName,
          about: dto.about,
          venues: dto.venues ?? [],
          event_date: dto.eventDate,
          audience_profile: dto.audienceProfile ?? [],
          age_group: dto.ageGroup,
          guest_count: dto.guestCount,
          sponsor_tiers: (dto.sponsorTiers ?? []).map((t) => ({ name: t.name, price: t.price })),
        }),
      });
    } catch {
      this.logger.error(`AI server unreachable at ${url}`);
      throw new InternalServerErrorException('AI service is currently unavailable. Please try again later.');
    }

    const data = (await response.json()) as AiDeckPlanResponse & { error?: string; detail?: string };

    if (!response.ok) {
      this.logger.error(`AI server returned ${response.status}: ${JSON.stringify(data)}`);

      if (data?.error === 'GEMINI_API_ERROR' || response.status === 502) {
        throw new ServiceUnavailableException('AI model is currently experiencing high demand. Please try again in a moment.');
      }

      throw new InternalServerErrorException('Failed to plan proposal deck content. Please try again.');
    }

    const slides: DeckSlideDto[] = [
      {
        layout: 'COVER',
        title: dto.eventName,
        subtitle: dto.venues?.length ? dto.venues.join(', ') : undefined,
      } as DeckSlideDto,
      ...data.middle_slides.map(
        (m) =>
          ({
            layout: m.layout,
            title: m.title,
            body: m.body,
            bullets: m.bullets,
            stats: m.stats,
          }) as DeckSlideDto,
      ),
    ];

    if (dto.sponsorTiers?.length) {
      slides.push({
        layout: 'PRICING_COMPARISON',
        title: 'Sponsor Pricing',
        pricingTiers: dto.sponsorTiers,
      } as DeckSlideDto);
    }

    slides.push({
      layout: 'CLOSING_CONTACT',
      title: "Let's Talk",
      body: data.closing_message,
    } as DeckSlideDto);

    return { slides };
  }
}

