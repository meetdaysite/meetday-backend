import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { OfficeParser } from 'officeparser';

const SUPPORTED_DOCUMENT_TYPES: Record<string, 'pdf' | 'docx' | 'pptx'> = {
  pdf: 'pdf',
  docx: 'docx',
  pptx: 'pptx',
};
// Keeps the extracted text within a sane size for an AI prompt — documents are supplementary
// context, not the whole input.
const MAX_EXTRACTED_TEXT_LENGTH = 6000;

// Shared by every "AI Copilot" feature (sponsorship proposals, campaigns, ...) that lets a user
// upload a PDF/DOCX/PPTX as extra context for draft generation.
@Injectable()
export class DocumentExtractionService {
  private readonly logger = new Logger(DocumentExtractionService.name);

  async extractText(buffer: Buffer, originalname: string): Promise<string> {
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
}
