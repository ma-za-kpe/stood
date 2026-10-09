import type { TrancheView } from '@stood/stood-sdk';
import type { StoodProof } from '../../application/board.js';

// T-0189: one fresh signed read of Stood's public tranche view becomes a proof, or nothing while Stood decides.
// The SDK has already refused any provider but the simulator or the PayPal sandbox, so no real money is involved
// and every proof stays marked simulated.
export class StoodTrancheProofs {
  constructor(private readonly stood: Readonly<{ getTranche(id: string): Promise<TrancheView> }>) {}
  async read(trancheId: string): Promise<StoodProof | null> {
    const v = await this.stood.getTranche(trancheId);
    if (v.state === 'HELD' && v.holdExpiresAt)
      return { trancheId, effect: 'HOLD', expiresAt: Date.parse(v.holdExpiresAt), simulated: true };
    if (!v.packageId || !v.settlement) return null;
    if (v.state === 'RELEASED' && v.settlement.effect === 'CAPTURE')
      return {
        trancheId,
        packageId: v.packageId,
        reference: v.settlement.reference,
        effect: 'CAPTURE',
        minor: v.amount.minor,
        currency: v.amount.currency,
        simulated: true,
      };
    if (
      v.state === 'REFUSED' &&
      v.settlement.effect === 'VOID' &&
      v.decision?.outcome === 'REFUSE' &&
      v.decision.namedField
    )
      return {
        trancheId,
        packageId: v.packageId,
        reference: v.settlement.reference,
        effect: 'VOID',
        punchList: [{ field: v.decision.namedField, reason: v.decision.reason }],
        resubmissionsLeft: v.resubmissionsLeft,
        simulated: true,
      };
    return null;
  }
}
