import { YardError } from '../ports/events.js';
import type { Board, Operator, SubmissionIntent } from './board.js';
export type PackageReceipt = Readonly<{
  id: string;
  trancheId: string;
  repository: string;
  baseCommit: string;
  commit: string;
}>;
export interface PackageGateway {
  submit(request: SubmissionIntent['request']): Promise<PackageReceipt>;
}
// Metadata delivery only. This gateway grants no financial authority.
export class SubmissionBridge {
  constructor(
    private readonly board: Board,
    private readonly gateway: PackageGateway,
  ) {}
  async recover(now: number): Promise<readonly { projectId: string; wo: string; status: 'DELIVERED' | 'WAIT' }[]> {
    const results: { projectId: string; wo: string; status: 'DELIVERED' | 'WAIT' }[] = [];
    let after = '';
    do {
      const page = await this.board.pendingSubmissions(after);
      for (const entry of page.submissions) {
        const { intent, projectId, wo } = entry;
        try {
          await this.submit(
            projectId,
            wo,
            intent.request.commit,
            intent.actor,
            intent.expectedVersion,
            intent.key,
            now,
          );
          results.push({ projectId, wo, status: 'DELIVERED' });
        } catch {
          results.push({ projectId, wo, status: 'WAIT' });
        }
      }
      after = page.nextCursor ?? '';
    } while (after);
    return results;
  }
  async submit(id: string, wo: string, commit: string, actor: Operator, version: number, key: string, now: number) {
    const intent = await this.board.prepareSubmission(id, wo, commit, actor, version, key, now);
    if (intent.status === 'CONFIRMED') return { id, version: intent.completedVersion! };
    const receipt = await this.gateway.submit(structuredClone(intent.request));
    if (
      !receipt ||
      typeof receipt.id !== 'string' ||
      !receipt.id.trim() ||
      receipt.id.length > 200 ||
      receipt.trancheId !== intent.request.trancheId ||
      receipt.repository !== intent.request.repository ||
      receipt.baseCommit !== intent.request.baseCommit ||
      receipt.commit !== intent.request.commit
    )
      throw new YardError('INVALID');
    const result = await this.board.completeSubmission(id, wo, intent, receipt.id);
    return { id: result.id, version: result.version };
  }
}
