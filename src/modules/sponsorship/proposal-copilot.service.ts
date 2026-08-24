import { BadRequestException, Injectable, InternalServerErrorException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OfficeParser } from 'officeparser';

const SUPPORTED_DOCUMENT_TYPES: Record<string, 'pdf' | 'docx' | 'pptx'> = {
  pdf: 'pdf',
  docx: 'docx',
  pptx: 'pptx',
};
// Keeps the extracted text within a sane size for the AI prompt — documents are supplementary
// context, not the whole input.
const MAX_EXTRACTED_TEXT_LENGTH = 6000;

@Injectable()
export class ProposalCopilotService {
  private readonly logger = new Logger(ProposalCopilotService.name);
  private readonly aiServerUrl: string;

  constructor(private readonly config: ConfigService) {
    this.aiServerUrl = this.config.get<string>('aiServerUrl')!;
  }

  // Extracts plain text from an uploaded PDF/DOCX/PPTX so it can be appended to the host's
  // Copilot prompt as extra context (e.g. an existing pitch deck or community brief).
  async extractDocumentText(buffer: Buffer, originalname: string): Promise<string> {
    const ext = originalname.split('.').pop()?.toLowerCase();
    const fileType = ext ? SUPPORTED_DOCUMENT_TYPES[ext] : undefined;
    if (!fileType) {
      throw new BadRequestException('Only PDF, DOCX, and PPTX files are supported.');
    }

    try {
      const ast = await OfficeParser.parseOffice(buffer, { fileType });
      const { value: text } = await ast.to('text');
      const trimmed = text.trim();
      if (!trimmed) {
        throw new BadRequestException('No readable text found in this document.');
      }
      return trimmed.slice(0, MAX_EXTRACTED_TEXT_LENGTH);
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`Failed to parse uploaded document "${originalname}": ${(err as Error).message}`);
      throw new BadRequestException('Could not read this document. Please check the file and try again.');
    }
  }

  async generateDraft(prompt: string, hostId: string): Promise<unknown> {
    const url = `${this.aiServerUrl}/proposal-copilot/generate-draft`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, host_id: hostId }),
      });
    } catch {
      this.logger.error(`AI server unreachable at ${url}`);
      throw new InternalServerErrorException('AI service is currently unavailable. Please try again later.');
    }

    const data = await response.json() as { error?: string; detail?: string };

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
