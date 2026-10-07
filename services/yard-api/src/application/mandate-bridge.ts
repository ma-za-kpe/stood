import type { Board, MandateIntent, MandateRequest, Operator } from './board.js';

export interface DraftGateway {
  createDraft(
    input: MandateRequest,
    key: string,
  ): Promise<Readonly<{ id: string; tranches: readonly Readonly<{ id: string; name: string }>[] }>>;
}
// T-0184: the frozen blueprint becomes a Stood allowance draft. Signing and funding stay with Stood and PayPal.
export class MandateBridge {
  constructor(
    private readonly board: Board,
    private readonly gateway: DraftGateway,
  ) {}
  async create(id: string, actor: Operator, version: number, key: string, now: number) {
    const intent = await this.board.prepareMandate(id, actor, version, key, now);
    return this.deliver(id, intent);
  }
  private async deliver(id: string, intent: MandateIntent) {
    if (intent.status === 'CREATED') return { allowanceId: intent.allowanceId, tranches: intent.tranches };
    // A retry after a lost reply reuses the same idempotency key, so Stood returns the same draft.
    const draft = await this.gateway.createDraft(structuredClone(intent.request), intent.key);
    const snapshot = await this.board.completeMandate(id, intent, draft);
    const mandate = (snapshot.data as { mandate: MandateIntent }).mandate;
    return { allowanceId: mandate.allowanceId, tranches: mandate.tranches };
  }
  async recover(): Promise<readonly { projectId: string; status: 'DELIVERED' | 'WAIT' }[]> {
    const results: { projectId: string; status: 'DELIVERED' | 'WAIT' }[] = [];
    let after = '';
    do {
      const page = await this.board.pendingMandates(after);
      for (const { projectId, intent } of page.mandates) {
        try {
          await this.deliver(projectId, intent);
          results.push({ projectId, status: 'DELIVERED' });
        } catch {
          results.push({ projectId, status: 'WAIT' });
        }
      }
      after = page.nextCursor ?? '';
    } while (after);
    return results;
  }
}
