import { Injectable, InternalServerErrorException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CampaignCopilotService {
  private readonly logger = new Logger(CampaignCopilotService.name);
  private readonly aiServerUrl: string;

  constructor(private readonly config: ConfigService) {
    this.aiServerUrl = this.config.get<string>('aiServerUrl')!;
  }

  async generateDraft(prompt: string, brandId: string): Promise<unknown> {
    const url = `${this.aiServerUrl}/campaign-copilot/generate-draft`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, brand_id: brandId }),
      });
    } catch {
      this.logger.error(`AI server unreachable at ${url}`);
      throw new InternalServerErrorException('AI service is currently unavailable. Please try again later.');
    }

    const data = (await response.json()) as { error?: string; detail?: string };

    if (!response.ok) {
      this.logger.error(`AI server returned ${response.status}: ${JSON.stringify(data)}`);

      if (data?.error === 'GEMINI_API_ERROR' || response.status === 502) {
        throw new ServiceUnavailableException('AI model is currently experiencing high demand. Please try again in a moment.');
      }

      throw new InternalServerErrorException('Failed to generate draft. Please try again.');
    }

    return data;
  }
}
