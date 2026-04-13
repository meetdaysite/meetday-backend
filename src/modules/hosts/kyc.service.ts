import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { KycInitiationResult, KycProvider } from './interfaces/kyc-provider.interface';

@Injectable()
export class KycService implements KycProvider {
  private readonly logger = new Logger(KycService.name);

  async initiateVerification(
    hostProfileId: string,
    // panNumber is passed to the real provider — never assign to a persistent variable
    _panNumber: string,
  ): Promise<KycInitiationResult> {
    const referenceId = `KYC-PAN-STUB-${uuid()}`;
    this.logger.log(`[STUB] PAN KYC initiation called for hostProfileId: ${hostProfileId} — referenceId: ${referenceId}`);
    // TODO: Replace with real KYC provider (KARZA / Digio / Signzy) call
    // Pass _panNumber to the provider API here and discard immediately after the call
    return { referenceId };
  }
}
