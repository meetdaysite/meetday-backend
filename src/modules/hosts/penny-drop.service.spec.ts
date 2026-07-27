import { Test } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { PennyDropService } from './penny-drop.service';
import { SandboxAuthService } from './sandbox-auth.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

const mockSandboxAuth = {
  host: 'https://api.sandbox.co.in',
  apiKey: 'test_api_key',
  getToken: jest.fn().mockResolvedValue('Bearer token123'),
};

function makeFetchResponse(body: object, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: jest.fn().mockResolvedValue(body),
  };
}

function makeFetchFailResponse(status: number, rawBody = 'error') {
  return { ok: false, status, text: jest.fn().mockResolvedValue(rawBody) };
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

const hostPayoutAccountId = 'payout-account-uuid';
const accountNumber = '1234567890';
const ifscCode = 'SBIN0001234';
const holderName = 'Test Host';
const phone = '+919876543210';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PennyDropService', () => {
  let service: PennyDropService;
  let originalFetch: typeof global.fetch;

  beforeEach(async () => {
    originalFetch = global.fetch;
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        PennyDropService,
        { provide: SandboxAuthService, useValue: mockSandboxAuth },
      ],
    }).compile();

    service = module.get(PennyDropService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('initiatePennyDrop', () => {
    it('returns VERIFIED immediately when pennyless verification succeeds', async () => {
      (global as any).fetch = jest.fn().mockResolvedValue(
        makeFetchResponse({ transaction_id: 'txn_pennyless_1', data: { account_exists: true, name_at_bank: 'Test Host' } }),
      );

      const result = await service.initiatePennyDrop(hostPayoutAccountId, accountNumber, ifscCode, holderName, phone);

      expect(result.verificationStatus).toBe('VERIFIED');
      expect(result.pennyDropReference).toBe('txn_pennyless_1');
      expect(result.bankName).toBe('Test Host');
    });

    it('returns FAILED immediately when pennyless says account does not exist', async () => {
      (global as any).fetch = jest.fn().mockResolvedValue(
        makeFetchResponse({ transaction_id: 'txn_pennyless_2', data: { account_exists: false, message: 'Invalid account' } }),
      );

      const result = await service.initiatePennyDrop(hostPayoutAccountId, accountNumber, ifscCode, holderName, phone);

      expect(result.verificationStatus).toBe('FAILED');
      expect(result.failureReason).toBe('Invalid account');
    });

    it('falls back to penny drop when pennyless returns no account_exists field', async () => {
      const pennyDropBody = { transaction_id: 'txn_penny_1', data: { account_exists: true, name_at_bank: 'Test Host' } };
      let callCount = 0;
      (global as any).fetch = jest.fn().mockImplementation(() => {
        callCount++;
        // First call: pennyless (no account_exists)
        if (callCount === 1) return Promise.resolve(makeFetchResponse({ transaction_id: 'txn_pennyless_3', data: { message: 'bank offline' } }));
        // Second call: penny drop
        return Promise.resolve(makeFetchResponse(pennyDropBody));
      });

      const result = await service.initiatePennyDrop(hostPayoutAccountId, accountNumber, ifscCode, holderName, phone);

      expect(callCount).toBe(2);
      expect(result.verificationStatus).toBe('VERIFIED');
      expect(result.pennyDropReference).toBe('txn_penny_1');
    });

    it('strips +91 prefix from phone number before sending to Sandbox', async () => {
      (global as any).fetch = jest.fn().mockResolvedValue(
        makeFetchResponse({ transaction_id: 'txn_pennyless_4', data: { account_exists: true } }),
      );

      await service.initiatePennyDrop(hostPayoutAccountId, accountNumber, ifscCode, holderName, '+919876543210');

      const calledUrl = (global as any).fetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('mobile=9876543210');
    });

    it('throws InternalServerErrorException when pennyless HTTP request fails', async () => {
      (global as any).fetch = jest.fn().mockResolvedValue(makeFetchFailResponse(503));

      await expect(
        service.initiatePennyDrop(hostPayoutAccountId, accountNumber, ifscCode, holderName, phone),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('throws InternalServerErrorException when penny drop HTTP request fails', async () => {
      let callCount = 0;
      (global as any).fetch = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve(makeFetchResponse({ transaction_id: 'x', data: { message: 'offline' } }));
        return Promise.resolve(makeFetchFailResponse(500));
      });

      await expect(
        service.initiatePennyDrop(hostPayoutAccountId, accountNumber, ifscCode, holderName, phone),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('returns FAILED (not throws) when pennyless hits the Sandbox test-environment "no saved example" 404', async () => {
      (global as any).fetch = jest.fn().mockResolvedValue(makeFetchFailResponse(404, sandboxTestFixtureMissBody('txn_404_pennyless')));

      const result = await service.initiatePennyDrop(hostPayoutAccountId, accountNumber, ifscCode, holderName, phone);

      expect(result.verificationStatus).toBe('FAILED');
      expect(result.pennyDropReference).toBe('txn_404_pennyless');
      expect(result.failureReason).toBe('Invalid account number or IFSC');
    });

    it('returns FAILED (not throws) when the penny drop fallback hits the Sandbox test-environment "no saved example" 404', async () => {
      let callCount = 0;
      (global as any).fetch = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve(makeFetchResponse({ transaction_id: 'x', data: { message: 'offline' } }));
        return Promise.resolve(makeFetchFailResponse(404, sandboxTestFixtureMissBody('txn_404_pennydrop')));
      });

      const result = await service.initiatePennyDrop(hostPayoutAccountId, accountNumber, ifscCode, holderName, phone);

      expect(callCount).toBe(2);
      expect(result.verificationStatus).toBe('FAILED');
      expect(result.pennyDropReference).toBe('txn_404_pennydrop');
      expect(result.failureReason).toBe('Account not found');
    });

    it('still throws InternalServerErrorException for a 404 that does not match the Sandbox test-fixture shape', async () => {
      (global as any).fetch = jest.fn().mockResolvedValue(makeFetchFailResponse(404, 'Not Found'));

      await expect(
        service.initiatePennyDrop(hostPayoutAccountId, accountNumber, ifscCode, holderName, phone),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});
