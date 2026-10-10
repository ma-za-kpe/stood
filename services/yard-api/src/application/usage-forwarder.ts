import { createHash } from 'node:crypto';
import type { UsageReceiptInput } from '@stood/stood-sdk';
import type { Board } from './board.js';

export type UsageSigner = Readonly<{
  keyId: string;
  root: string;
  // Base64 Ed25519 signature over Stood's usage-receipt payload.
  sign(payload: string): string;
}>;
type Stood = Readonly<{ confirmUsage(trancheId: string, receipt: UsageReceiptInput): Promise<unknown> }>;
// Stood's signed bytes for a usage receipt ("stood-usage-receipt/v1" and the fields, joined by NUL).
export function usagePayload(r: Omit<UsageReceiptInput, 'signature'>): string {
  return [
    'stood-usage-receipt/v1',
    r.allowanceId,
    r.trancheId,
    r.commit,
    r.authority.keyId,
    r.authority.root,
    String(r.observedAt),
    r.nonce,
  ].join('\0');
}

// C4 (#77): forwards each buyer usage confirmation to Stood as a signed receipt, once. The nonce and time come from
// the confirmation itself, so a retry after a lost reply is the identical receipt. Stood's refusal is recorded with
// its reason; anything unavailable is tried again on the next run.
export class UsageForwarder {
  constructor(
    private readonly board: Board,
    private readonly stood: Stood,
    private readonly signer: UsageSigner,
    private readonly clock: () => number,
  ) {}
  async run(): Promise<{ accepted: number; refused: number; waiting: number }> {
    const count = { accepted: 0, refused: 0, waiting: 0 };
    let after = '';
    do {
      const page = await this.board.pendingUsage(after);
      for (const item of page.items) {
        const unsigned = {
          version: 1 as const,
          allowanceId: item.allowanceId,
          trancheId: item.trancheId,
          commit: item.commit,
          authority: { keyId: this.signer.keyId, root: this.signer.root },
          observedAt: item.confirmedAt,
          nonce: `yard-usage-${createHash('sha256')
            .update(JSON.stringify([item.projectId, item.wo, item.commit, item.confirmedAt]))
            .digest('hex')
            .slice(0, 40)}`,
        };
        let answer: { status: 'ACCEPTED' | 'REFUSED'; reason: string | null };
        try {
          await this.stood.confirmUsage(item.trancheId, {
            ...unsigned,
            signature: this.signer.sign(usagePayload(unsigned)),
          });
          answer = { status: 'ACCEPTED', reason: null };
        } catch (error) {
          // Only Stood refusing the receipt itself (422) is final; anything else is tried again on the next run.
          if ((error as { code?: unknown }).code !== 'VALIDATION') {
            count.waiting++;
            continue;
          }
          answer = { status: 'REFUSED', reason: 'refused_by_stood' };
        }
        try {
          const { version } = await this.board.events.load(item.projectId);
          await this.board.usageForwarded(item.projectId, item.wo, version, { at: this.clock(), ...answer });
          count[answer.status === 'ACCEPTED' ? 'accepted' : 'refused']++;
        } catch {
          count.waiting++;
        }
      }
      after = page.nextCursor ?? '';
    } while (after);
    return count;
  }
}
