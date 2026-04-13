export const KYC_PROVIDER = Symbol('KYC_PROVIDER');

export interface KycInitiationResult {
  referenceId: string;
}

export interface KycProvider {
  initiateVerification(
    hostProfileId: string,
    panNumber: string,
  ): Promise<KycInitiationResult>;
}
