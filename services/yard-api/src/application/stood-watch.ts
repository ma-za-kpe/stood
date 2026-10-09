import type { Board, StoodProof } from './board.js';

export interface TrancheProofs {
  read(trancheId: string): Promise<StoodProof | null>;
}
// T-0189: Stood sends platforms no notifications, so Yard reads every tranche it waits on and applies only what a
// fresh read proves. Event ids come from the Stood state read, so a repeated read is a no-op, never a second event.
export class StoodWatch {
  constructor(
    private readonly board: Board,
    private readonly proofs: TrancheProofs,
  ) {}
  async run(): Promise<{ applied: number; waiting: number }> {
    let applied = 0,
      waiting = 0,
      after = '';
    do {
      const page = await this.board.awaitingStood(after);
      for (const item of page.items) {
        try {
          const proof = await this.proofs.read(item.trancheId);
          const wanted = item.waitingFor === 'HOLD' ? proof?.effect === 'HOLD' : proof?.effect !== 'HOLD';
          if (!proof || !wanted || proof.trancheId !== item.trancheId) {
            waiting++;
            continue;
          }
          const version = (await this.board.events.load(item.projectId)).version;
          const eventId = `read:${proof.trancheId}:${proof.effect}:${'reference' in proof ? proof.reference : proof.expiresAt}`;
          if (proof.effect === 'HOLD')
            await this.board.holdConfirmed(item.projectId, item.wo, { ...proof, eventId }, version);
          else if (proof.effect === 'CAPTURE')
            await this.board.settlement(item.projectId, item.wo, { ...proof, eventId }, version);
          else await this.board.refusal(item.projectId, item.wo, { ...proof, eventId }, version);
          applied++;
        } catch {
          // Unavailable, stale or not matching what Yard waits for: try again on the next run.
          waiting++;
        }
      }
      after = page.nextCursor ?? '';
    } while (after);
    return { applied, waiting };
  }
}
