import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuid } from 'uuid';

export interface PennyDropInitiationResult {
  pennyDropReference: string;
}

@Injectable()
export class PennyDropService {
  private readonly logger = new Logger(PennyDropService.name);

  async initiatePennyDrop(
    hostPayoutAccountId: string,
    // accountNumber and ifscCode are passed to Razorpay — never stored
    _accountNumber: string,
    _ifscCode: string,
  ): Promise<PennyDropInitiationResult> {
    const pennyDropReference = `PENNY-STUB-${uuid()}`;
    this.logger.log(
      `[STUB] Penny drop initiation for payoutAccountId: ${hostPayoutAccountId} — ref: ${pennyDropReference}`,
    );
    // TODO: Replace with real Razorpay Fund Account Validation API call
    // POST https://api.razorpay.com/v1/fund_accounts/validations
    // Pass _accountNumber and _ifscCode — discard immediately after the call
    return { pennyDropReference };
  }
}
