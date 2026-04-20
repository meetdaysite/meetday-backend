import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { SandboxAuthService } from './sandbox-auth.service';

export interface PennyDropInitiationResult {
  pennyDropReference: string;
  // Present for synchronous providers (Sandbox). Absent for async providers (result via webhook).
  verificationStatus?: 'VERIFIED' | 'FAILED';
  bankName?: string;
  failureReason?: string;
}

interface SandboxPennylessResponse {
  transaction_id: string;
  data: {
    account_exists?: boolean;
    name_at_bank?: string;
    message?: string;
  };
}

interface SandboxPennyDropResponse {
  transaction_id: string;
  data: {
    account_exists?: boolean;
    name_at_bank?: string;
    message?: string;
  };
}

@Injectable()
export class PennyDropService {
  private readonly logger = new Logger(PennyDropService.name);

  constructor(private readonly sandboxAuth: SandboxAuthService) {}

  async initiatePennyDrop(
    hostPayoutAccountId: string,
    // accountNumber and ifscCode passed to Sandbox — never stored
    accountNumber: string,
    ifscCode: string,
    accountHolderName: string,
    phone: string,
  ): Promise<PennyDropInitiationResult> {
    // Strip +91 country code — Sandbox expects a 10-digit mobile number
    const mobile = phone.startsWith('+91') ? phone.slice(3) : phone;
    const params = new URLSearchParams({ name: accountHolderName, mobile });

    const token = await this.sandboxAuth.getToken();
    const headers = {
      authorization: token,
      'x-api-key': this.sandboxAuth.apiKey,
    };

    // ── Step 1: Try pennyless verification ────────────────────────────────
    const pennylessUrl = `${this.sandboxAuth.host}/bank/${ifscCode}/accounts/${accountNumber}/penniless-verify?${params}`;
    const pennylessRes = await fetch(pennylessUrl, { headers });

    if (!pennylessRes.ok) {
      this.logger.error(
        `Pennyless verification request failed for payoutAccountId: ${hostPayoutAccountId} — HTTP ${pennylessRes.status}`,
      );
      throw new InternalServerErrorException('Bank verification service unavailable');
    }

    const pennylessBody = (await pennylessRes.json()) as SandboxPennylessResponse;
    this.logger.debug(`Pennyless verification response: ${JSON.stringify(pennylessBody)}`);
    const pennylessData = pennylessBody.data;

    if (pennylessData.account_exists === true) {
      this.logger.log(`Bank verification VERIFIED (pennyless) for payoutAccountId: ${hostPayoutAccountId}`);
      return {
        pennyDropReference: pennylessBody.transaction_id,
        verificationStatus: 'VERIFIED',
        bankName: pennylessData.name_at_bank,
      };
    }

    if (pennylessData.account_exists === false) {
      const failureReason = pennylessData.message ?? 'Invalid account number or IFSC';
      this.logger.warn(`Bank verification FAILED (pennyless) for payoutAccountId: ${hostPayoutAccountId} — ${failureReason}`);
      return {
        pennyDropReference: pennylessBody.transaction_id,
        verificationStatus: 'FAILED',
        failureReason,
      };
    }

    // account_exists is absent → bank is offline, fall back to penny drop
    this.logger.warn(
      `Pennyless verification unavailable for payoutAccountId: ${hostPayoutAccountId} (${pennylessData.message ?? 'bank offline'}) — falling back to penny drop`,
    );

    // ── Step 2: Fallback — penny drop ──────────────────────────────────────
    const pennyDropUrl = `${this.sandboxAuth.host}/bank/${ifscCode}/accounts/${accountNumber}/verify?${params}`;
    const pennyDropRes = await fetch(pennyDropUrl, { headers });

    if (!pennyDropRes.ok) {
      this.logger.error(
        `Penny drop request failed for payoutAccountId: ${hostPayoutAccountId} — HTTP ${pennyDropRes.status}`,
      );
      throw new InternalServerErrorException('Bank verification service unavailable');
    }

    const pennyDropBody = (await pennyDropRes.json()) as SandboxPennyDropResponse;
    this.logger.debug(`Penny drop verification response: ${JSON.stringify(pennyDropBody)}`);
    const pennyDropData = pennyDropBody.data;

    if (pennyDropData.account_exists === true) {
      this.logger.log(`Bank verification VERIFIED (penny drop) for payoutAccountId: ${hostPayoutAccountId}`);
      return {
        pennyDropReference: pennyDropBody.transaction_id,
        verificationStatus: 'VERIFIED',
        bankName: pennyDropData.name_at_bank,
      };
    }

    const failureReason = pennyDropData.message ?? 'Account not found';
    this.logger.warn(`Bank verification FAILED (penny drop) for payoutAccountId: ${hostPayoutAccountId} — ${failureReason}`);
    return {
      pennyDropReference: pennyDropBody.transaction_id,
      verificationStatus: 'FAILED',
      failureReason,
    };
  }
}
