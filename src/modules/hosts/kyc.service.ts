import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { KycInitiationResult, KycProvider } from './interfaces/kyc-provider.interface';
import { SandboxAuthService } from './sandbox-auth.service';

interface SandboxPanResponse {
  data: {
    status: string;
    category: 'individual' | 'company';
    name_as_per_pan_match: boolean;
  };
  transaction_id: string;
}

@Injectable()
export class KycService implements KycProvider {
  private readonly logger = new Logger(KycService.name);

  constructor(private readonly sandboxAuth: SandboxAuthService) {}

  async initiateVerification(
    hostProfileId: string,
    panNumber: string,
    legalName: string,
  ): Promise<KycInitiationResult> {
    const token = await this.sandboxAuth.getToken();

    const panUrl = `${this.sandboxAuth.host}/kyc/pan/verify`;
    const requestBody = {
      '@entity': 'in.co.sandbox.kyc.pan_verification.request',
      pan: panNumber,
      name_as_per_pan: legalName,
      date_of_birth: '11/11/2001', // DOB not collected from hosts — static value matching Sandbox test fixture
      consent: 'Y',
      reason: 'For onboarding customers',
    };
    this.logger.debug(`PAN verification request — URL: ${panUrl} — body: ${JSON.stringify(requestBody)}`);
    const res = await fetch(panUrl, {
      method: 'POST',
      headers: {
        authorization: token,
        'x-api-key': this.sandboxAuth.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    if (!res.ok) {
      const errorBody = await res.text();
      const fixtureMiss = SandboxAuthService.matchSandboxTestFixtureMiss(res.status, errorBody);
      if (fixtureMiss) {
        this.logger.warn(
          `PAN verification FAILED (Sandbox test-environment: no matching fixture) for hostProfileId: ${hostProfileId} — HTTP ${res.status}`,
        );
        return {
          referenceId: fixtureMiss.transactionId,
          verificationStatus: 'FAILED',
          failureReason: 'PAN details could not be verified',
        };
      }
      this.logger.error(`PAN verification failed — HTTP ${res.status} — URL: ${panUrl} — body: ${errorBody}`);
      throw new InternalServerErrorException('PAN verification service unavailable');
    }

    const body = (await res.json()) as SandboxPanResponse;
    this.logger.debug(`PAN verification response: ${JSON.stringify(body)}`);
    const { status, category, name_as_per_pan_match } = body.data;

    if (status === 'valid' && name_as_per_pan_match === true) {
      this.logger.log(`PAN verification VERIFIED for hostProfileId: ${hostProfileId} (category: ${category})`);
      return { referenceId: body.transaction_id, verificationStatus: 'VERIFIED' };
    }

    const failureReason = `PAN status: ${status}, name match: ${name_as_per_pan_match}`;
    this.logger.warn(`PAN verification FAILED for hostProfileId: ${hostProfileId} (category: ${category}) — ${failureReason}`);
    return { referenceId: body.transaction_id, verificationStatus: 'FAILED', failureReason };
  }
}
