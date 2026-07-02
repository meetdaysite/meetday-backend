import { Test } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SandboxAuthService } from './sandbox-auth.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

const mockConfig = {
  get: jest.fn((key: string) => {
    if (key === 'sandbox.host') return 'https://api.sandbox.co.in';
    if (key === 'sandbox.apiKey') return 'test_api_key';
    if (key === 'sandbox.apiSecret') return 'test_api_secret';
    return undefined;
  }),
};

function mockFetchOk(body: object) {
  return jest.fn().mockResolvedValue({
    ok: true,
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  });
}

function mockFetchFail(status = 401) {
  return jest.fn().mockResolvedValue({ ok: false, status });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SandboxAuthService', () => {
  let service: SandboxAuthService;
  let originalFetch: typeof global.fetch;

  beforeEach(async () => {
    originalFetch = global.fetch;

    const module = await Test.createTestingModule({
      providers: [
        SandboxAuthService,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get(SandboxAuthService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('reads host, apiKey, and apiSecret from config', () => {
    expect(service.host).toBe('https://api.sandbox.co.in');
    expect(service.apiKey).toBe('test_api_key');
  });

  describe('getToken', () => {
    it('returns the access token on success', async () => {
      (global as any).fetch = mockFetchOk({ access_token: 'my_token_xyz', transaction_id: 'txn_1' });

      const token = await service.getToken();

      expect(token).toBe('my_token_xyz');
    });

    it('throws InternalServerErrorException when Sandbox auth fails', async () => {
      (global as any).fetch = mockFetchFail(401);

      await expect(service.getToken()).rejects.toThrow(InternalServerErrorException);
    });
  });
});
