import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { KycInitiationResult, KycProvider } from './interfaces/kyc-provider.interface';

@Injectable()
export class KycService implements KycProvider {
  private readonly logger = new Logger(KycService.name);

  async initiateVerification(
    hostProfileId: string,
    // aadhaarNumber is passed to the real provider — never assign to a persistent variable
    _aadhaarNumber: string,
  ): Promise<KycInitiationResult> {
    const referenceId = `KYC-STUB-${uuid()}`;
    this.logger.log(`[STUB] KYC initiation called for hostProfileId: ${hostProfileId} — referenceId: ${referenceId}`);
    // TODO: Replace with real KYC provider (Digio / Signzy / KARZA) call
    // Pass _aadhaarNumber to the provider API here and discard immediately after the call
    return { referenceId };
  }
}
