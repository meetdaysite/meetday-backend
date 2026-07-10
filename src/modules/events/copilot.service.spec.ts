import { Test } from '@nestjs/testing';
import { InternalServerErrorException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CopilotService } from './copilot.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

const AI_SERVER_URL = 'https://ai.internal';

const mockConfig = {
  get: jest.fn((key: string) => {
    if (key === 'aiServerUrl') return AI_SERVER_URL;
    return undefined;
  }),
};

function mockFetchOk(body: object) {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue(body),
  });
}

function mockFetchFail(status: number, body: object) {
  return jest.fn().mockResolvedValue({
    ok: false,
    status,
    json: jest.fn().mockResolvedValue(body),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CopilotService', () => {
  let service: CopilotService;
  let originalFetch: typeof global.fetch;

  beforeEach(async () => {
    originalFetch = global.fetch;

    const module = await Test.createTestingModule({
      providers: [
        CopilotService,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get(CopilotService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('generateDraft', () => {
    it('returns the AI response body on success', async () => {
      const aiResponse = { title: 'Jazz Night', description: 'An evening of jazz.' };
      (global as any).fetch = mockFetchOk(aiResponse);

      const result = await service.generateDraft('Jazz night event', 'host-1');

      expect(result).toEqual(aiResponse);
    });

    it('calls the correct AI server URL with prompt and host_id', async () => {
      (global as any).fetch = mockFetchOk({ title: 'Test' });

      await service.generateDraft('Tech meetup', 'host-2');

      expect((global as any).fetch).toHaveBeenCalledWith(
        `${AI_SERVER_URL}/copilot/generate-draft`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ prompt: 'Tech meetup', host_id: 'host-2' }),
        }),
      );
    });

    it('throws InternalServerErrorException when AI server is unreachable', async () => {
      (global as any).fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(service.generateDraft('Test', 'host-3')).rejects.toThrow(InternalServerErrorException);
    });

    it('throws ServiceUnavailableException on Gemini API error (502)', async () => {
      (global as any).fetch = mockFetchFail(502, { error: 'GEMINI_API_ERROR' });

      await expect(service.generateDraft('Test', 'host-4')).rejects.toThrow(ServiceUnavailableException);
    });

    it('throws ServiceUnavailableException when error field is GEMINI_API_ERROR', async () => {
      (global as any).fetch = mockFetchFail(500, { error: 'GEMINI_API_ERROR' });

      await expect(service.generateDraft('Test', 'host-5')).rejects.toThrow(ServiceUnavailableException);
    });

    it('throws InternalServerErrorException for other non-ok AI server responses', async () => {
      (global as any).fetch = mockFetchFail(500, { detail: 'Internal error' });

      await expect(service.generateDraft('Test', 'host-6')).rejects.toThrow(InternalServerErrorException);
    });
  });
});
