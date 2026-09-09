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

// Splits a free-text deliverables blurb into short bullet lines. Hosts/AI write these as either
// newline-separated items, a genuine comma-separated list of short phrases, or full prose
// sentences (which happen to contain grammatical commas). Blindly splitting on every comma broke
// real sentences mid-clause (e.g. "...event signage, backdrops, and interactive styling stations."
// became 3 disjointed fragments including a lone orphaned word) — so commas are only treated as a
// delimiter when the text has no sentence-ending punctuation to split on instead.
function toBullets(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // Respect explicit line breaks first — the most reliable signal of intentional list items.
  const lines = trimmed
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (lines.length > 1) return lines;

  // Single block of text that reads as prose (has sentence-ending punctuation) — split into
  // whole sentences instead of on every comma, so no bullet breaks mid-clause.
  if (/[.!?]\s+\S/.test(trimmed)) {
    return trimmed
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // No sentence punctuation at all — this is a genuine comma-separated list of short phrases.
  return trimmed
    .split(/,\s*/)
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
          event_date: dto.eventDate,
          event_end_date: dto.eventEndDate,
          event_time: dto.eventTime,
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

    // Multi-day events show a "start – end" range; single-day events just show the one date.
    const dateRange =
      dto.eventEndDate && dto.eventEndDate !== dto.eventDate
        ? [dto.eventDate, dto.eventEndDate].filter(Boolean).join(' – ')
        : dto.eventDate;

    const slides: DeckSlideDto[] = [
      {
        layout: 'COVER',
        title: dto.eventTitle,
        subtitle: data.tagline,
        body: [dto.hostName, [dateRange, dto.eventTime].filter(Boolean).join(', '), dto.location].filter(Boolean).join(' • '),
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


