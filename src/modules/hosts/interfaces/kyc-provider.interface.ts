export const KYC_PROVIDER = Symbol('KYC_PROVIDER');

export interface KycInitiationResult {
  referenceId: string;
  // Present only for synchronous providers (e.g. Sandbox).
  // Async providers leave these undefined — result arrives via webhook.
  verificationStatus?: 'VERIFIED' | 'FAILED';
  failureReason?: string;
}

export interface KycProvider {
  initiateVerification(
    hostProfileId: string,
    panNumber: string,
    legalName: string,
  ): Promise<KycInitiationResult>;
}
