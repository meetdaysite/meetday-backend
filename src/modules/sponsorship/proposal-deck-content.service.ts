import { Injectable, InternalServerErrorException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GenerateProposalDeckPlanDto, GenerateProposalDeckPlanResponseDto } from './dto/generate-proposal-deck-plan.dto';
import { DeckSlideDto } from './dto/deck-slide.dto';

type AiDeckPlanResponse = {
  tagline: string;
  about_community: string;
  event_overview: string;
  sponsor_roi_pitch: string;
  onsite_deliverables: string;
  digital_deliverables: string;
  custom_perks: string;
  closing_message: string;
};

// Splits a free-text deliverables blurb into short bullet lines — hosts write these as either
// comma-separated or newline-separated; either way we want a clean bullet list on the slide.
function toBullets(text: string): string[] {
  return text
    .split(/\n+|,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Calls the meetday-ai microservice to fill in AI fallback copy for any optional narrative
// fields the host left empty, then assembles the full, fixed 10-slide deck plan deterministically
// from the proposal's own structured "Proposal Deck Form" data. Mirrors ProposalCopilotService's
// calling convention (same AI server, same error handling).
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
          host_name: dto.hostName,
          event_title: dto.eventTitle,
          tagline: dto.tagline,
          about_community: dto.aboutCommunity,
          event_overview: dto.eventOverview,
          sponsor_roi_pitch: dto.sponsorROIPitch,
          location: dto.location,
          hero_metric_value: dto.heroMetricValue,
          hero_metric_label: dto.heroMetricLabel,
          target_audience_profile: dto.targetAudienceProfile,
          past_sponsors: (dto.pastSponsors ?? []).map((p) => ({ name: p.name, projectReference: p.projectReference })),
          sponsor_tiers: (dto.sponsorTiers ?? []).map((t) => ({ name: t.name, price: t.price })),
          onsite_deliverables: dto.onsiteDeliverables,
          digital_deliverables: dto.digitalDeliverables,
          custom_perks: dto.customPerks,
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

    const hasPastSponsors = (dto.pastSponsors ?? []).length > 0;

    const slides: DeckSlideDto[] = [
      {
        layout: 'COVER',
        title: dto.eventTitle,
        subtitle: data.tagline,
        body: [dto.hostName, dto.location].filter(Boolean).join(' • '),
      } as DeckSlideDto,
      { layout: 'VALUE_PROP', title: 'Event Overview', body: data.event_overview } as DeckSlideDto,
      { layout: 'VALUE_PROP', title: `About ${dto.hostName}`, body: data.about_community } as DeckSlideDto,
      {
        layout: 'STAT_HIGHLIGHT',
        title: 'Audience & Reach',
        body: dto.targetAudienceProfile,
        stats:
          dto.heroMetricValue && dto.heroMetricLabel
            ? [{ label: dto.heroMetricLabel, value: dto.heroMetricValue }]
            : [],
      } as DeckSlideDto,
      { layout: 'VALUE_PROP', title: 'Why Sponsor This', body: data.sponsor_roi_pitch } as DeckSlideDto,
      {
        layout: 'PAST_SPONSORS',
        title: 'Past & Confirmed Sponsors',
        body: hasPastSponsors ? undefined : "This will be among our community's first sponsorship partnerships.",
        pastSponsors: dto.pastSponsors ?? [],
      } as DeckSlideDto,
      { layout: 'BULLET_LIST', title: 'On-Site Visibility', bullets: toBullets(data.onsite_deliverables) } as DeckSlideDto,
      { layout: 'BULLET_LIST', title: 'Digital & Media Deliverables', bullets: toBullets(data.digital_deliverables) } as DeckSlideDto,
      {
        layout: 'PRICING_COMPARISON',
        title: 'Sponsorship Packages',
        body: data.custom_perks,
        pricingTiers: dto.sponsorTiers ?? [],
        openToBarter: dto.openToBarter,
        sponsorshipDeadline: dto.sponsorshipDeadline,
      } as DeckSlideDto,
      { layout: 'CLOSING_CONTACT', title: "Let's Talk", body: data.closing_message } as DeckSlideDto,
    ];

    return { slides };
  }
}


