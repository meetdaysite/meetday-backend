import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DocumentExtractionService } from './document-extraction.service';
import { OfficeParser } from 'officeparser';

jest.mock('officeparser', () => ({
  OfficeParser: { parseOffice: jest.fn() },
}));

describe('DocumentExtractionService', () => {
  let service: DocumentExtractionService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [DocumentExtractionService],
    }).compile();
    service = module.get(DocumentExtractionService);
  });

  describe('extractText()', () => {
    it('rejects unsupported file extensions', async () => {
      await expect(service.extractText(Buffer.from('x'), 'notes.txt')).rejects.toThrow(BadRequestException);
    });

    it('extracts and trims text for a supported pdf', async () => {
      (OfficeParser.parseOffice as jest.Mock).mockResolvedValue({
        to: jest.fn().mockResolvedValue({ value: '  Community deck content  ' }),
      });

      const result = await service.extractText(Buffer.from('x'), 'deck.pdf');

      expect(OfficeParser.parseOffice).toHaveBeenCalledWith(expect.any(Buffer), { fileType: 'pdf' });
      expect(result).toBe('Community deck content');
    });

    it('supports docx and pptx extensions', async () => {
      (OfficeParser.parseOffice as jest.Mock).mockResolvedValue({
        to: jest.fn().mockResolvedValue({ value: 'text' }),
      });

      await service.extractText(Buffer.from('x'), 'deck.docx');
      expect(OfficeParser.parseOffice).toHaveBeenCalledWith(expect.any(Buffer), { fileType: 'docx' });

      await service.extractText(Buffer.from('x'), 'deck.pptx');
      expect(OfficeParser.parseOffice).toHaveBeenCalledWith(expect.any(Buffer), { fileType: 'pptx' });
    });

    it('rejects a document with no readable text', async () => {
      (OfficeParser.parseOffice as jest.Mock).mockResolvedValue({
        to: jest.fn().mockResolvedValue({ value: '   ' }),
      });

      await expect(service.extractText(Buffer.from('x'), 'deck.pdf')).rejects.toThrow(BadRequestException);
    });

    it('truncates very long extracted text', async () => {
      const longText = 'a'.repeat(10000);
      (OfficeParser.parseOffice as jest.Mock).mockResolvedValue({
        to: jest.fn().mockResolvedValue({ value: longText }),
      });

      const result = await service.extractText(Buffer.from('x'), 'deck.pdf');

      expect(result.length).toBe(6000);
    });

    it('wraps a parse failure as BadRequestException', async () => {
      (OfficeParser.parseOffice as jest.Mock).mockRejectedValue(new Error('corrupt file'));

      await expect(service.extractText(Buffer.from('x'), 'deck.pdf')).rejects.toThrow(BadRequestException);
    });
  });
});
