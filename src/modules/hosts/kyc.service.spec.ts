import { Test } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { KycService } from './kyc.service';
import { SandboxAuthService } from './sandbox-auth.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

const mockSandboxAuth = {
  host: 'https://api.sandbox.co.in',
  apiKey: 'test_api_key',
  getToken: jest.fn().mockResolvedValue('Bearer token123'),
};

function mockFetchOk(body: object) {
  return jest.fn().mockResolvedValue({
    ok: true,
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(''),
  });
}

function mockFetchFail(status = 500, rawBody = 'error') {
  return jest.fn().mockResolvedValue({ ok: false, status, text: jest.fn().mockResolvedValue(rawBody) });
}

function sandboxTestFixtureMissBody(transactionId: string) {
  return JSON.stringify({
    code: 404,
    timestamp: Date.now(),
    message:
      'Test environment: Request does not match any saved example. Learn more: https://help.sandbox.co.in/portal/en/kb/articles/sandbox-test-environment',
    transaction_id: transactionId,
  });
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const hostProfileId = 'host-profile-uuid';
const panNumber = 'ABCDE1234F';
const legalName = 'Test Host';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('KycService', () => {
  let service: KycService;
  let originalFetch: typeof global.fetch;

  beforeEach(async () => {
    originalFetch = global.fetch;
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        KycService,
        { provide: SandboxAuthService, useValue: mockSandboxAuth },
      ],
    }).compile();

    service = module.get(KycService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('initiateVerification', () => {
    it('returns VERIFIED when PAN is valid and name matches', async () => {
      (global as any).fetch = mockFetchOk({
        transaction_id: 'txn_pan_1',
        data: { status: 'valid', category: 'individual', name_as_per_pan_match: true },
      });

      const result = await service.initiateVerification(hostProfileId, panNumber, legalName);

      expect(result.verificationStatus).toBe('VERIFIED');
      expect(result.referenceId).toBe('txn_pan_1');
    });

    it('returns FAILED when PAN status is invalid', async () => {
      (global as any).fetch = mockFetchOk({
        transaction_id: 'txn_pan_2',
        data: { status: 'invalid', category: 'individual', name_as_per_pan_match: false },
      });

      const result = await service.initiateVerification(hostProfileId, panNumber, legalName);

      expect(result.verificationStatus).toBe('FAILED');
      expect(result.failureReason).toBeDefined();
    });

    it('returns FAILED when name does not match even with valid PAN', async () => {
      (global as any).fetch = mockFetchOk({
        transaction_id: 'txn_pan_3',
        data: { status: 'valid', category: 'individual', name_as_per_pan_match: false },
      });

      const result = await service.initiateVerification(hostProfileId, panNumber, legalName);

      expect(result.verificationStatus).toBe('FAILED');
    });

    it('throws InternalServerErrorException when Sandbox HTTP request fails', async () => {
      (global as any).fetch = mockFetchFail(503);

      await expect(service.initiateVerification(hostProfileId, panNumber, legalName)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('returns FAILED (not throws) when Sandbox returns its test-environment "no saved example" 404', async () => {
      (global as any).fetch = mockFetchFail(404, sandboxTestFixtureMissBody('txn_404_fixture_miss'));

      const result = await service.initiateVerification(hostProfileId, panNumber, legalName);

      expect(result.verificationStatus).toBe('FAILED');
      expect(result.referenceId).toBe('txn_404_fixture_miss');
      expect(result.failureReason).toBeDefined();
    });

    it('still throws InternalServerErrorException for a 404 that does not match the Sandbox test-fixture shape', async () => {
      (global as any).fetch = mockFetchFail(404, 'Not Found');

      await expect(service.initiateVerification(hostProfileId, panNumber, legalName)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('calls sandboxAuth.getToken before making the PAN request', async () => {
      (global as any).fetch = mockFetchOk({
        transaction_id: 'txn_pan_4',
        data: { status: 'valid', category: 'individual', name_as_per_pan_match: true },
      });

      await service.initiateVerification(hostProfileId, panNumber, legalName);

      expect(mockSandboxAuth.getToken).toHaveBeenCalledTimes(1);
    });
  });
});
