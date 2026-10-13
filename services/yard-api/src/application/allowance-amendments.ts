import type { AllowanceVersionView, BaselineInput, BaselineView, MandateView } from '@stood/stood-sdk';
import { YardError } from '../ports/events.js';
import type { Board } from './board.js';
import type { AmendmentIntent, EvidenceChange } from './board-amendment-types.js';
import { fingerprint, type MandateRequest, type Operator } from './board-state.js';

export interface AmendmentGateway {
  requestBaseline(input: BaselineInput, key: string): Promise<BaselineView>;
  proposeAllowanceVersion(
    id: string,
    expectedVersion: number,
    input: MandateRequest,
    key: string,
  ): Promise<AllowanceVersionView>;
  requestVersionMandate(id: string, version: number, key: string): Promise<MandateView>;
}
export class AllowanceAmendments {
  constructor(
    private readonly board: Board,
    private readonly gateway: AmendmentGateway,
  ) {}
  async propose(id: string, actor: Operator, version: number, key: string, changes: readonly EvidenceChange[]) {
    return this.deliver(id, await this.board.prepareAmendment(id, actor, version, key, changes));
  }
  async renew(id: string, actor: Operator, version: number, key: string, amendmentKey: string) {
    return this.deliver(id, await this.board.renewAmendmentConsent(id, actor, version, key, amendmentKey));
  }
  private view(intent: AmendmentIntent, status: string) {
    return {
      key: intent.key,
      allowanceId: intent.allowanceId,
      termsVersion: intent.receipt?.version ?? null,
      status,
      approveUrl: intent.signing?.status === 'AWAITING_APPROVAL' ? intent.signing.approveUrl : null,
    };
  }
  private async deliver(id: string, intent: AmendmentIntent) {
    if (intent.status !== 'RESERVED') return this.view(intent, intent.status);
    for (const change of intent.changes) {
      const params = intent.request.milestones.find(
        (m) => m.params.testBundleHash === change.testBundleHash && m.params.manifestHash === change.manifestHash,
      )?.params;
      if (!params || typeof params.repository !== 'string' || typeof params.baseCommit !== 'string')
        throw new YardError('INVALID');
      const run = await this.gateway.requestBaseline(
        {
          repository: params.repository,
          baseCommit: params.baseCommit,
          testBundleHash: change.testBundleHash,
          manifestHash: change.manifestHash,
          testIds: change.testIds,
          tests: change.tests,
        },
        `${intent.key}:baseline:${fingerprint(change.milestoneId)}`,
      );
      if (
        run.repository !== params.repository ||
        run.baseCommit !== params.baseCommit ||
        run.testBundleHash !== change.testBundleHash
      )
        throw new YardError('INVALID');
      if (run.status === 'QUEUED') return this.view(intent, 'BASELINE_RUNNING');
      if (
        run.status !== 'DONE' ||
        !run.evidenceSha256 ||
        !/^[a-f0-9]{64}$/.test(run.evidenceSha256) ||
        !run.tests ||
        run.tests.length !== change.testIds.length ||
        new Set(run.tests.map((t) => t.id)).size !== change.testIds.length ||
        !run.tests.every((t) => change.testIds.includes(t.id) && t.status === 'FAIL')
      ) {
        const rejected = await this.board.recordAmendment(id, intent.key, null, null, true);
        return this.view(rejected, 'NEEDS_REVISION');
      }
    }
    const receipt = await this.gateway.proposeAllowanceVersion(
      intent.allowanceId,
      intent.expectedVersion,
      structuredClone(intent.request),
      intent.key,
    );
    await this.board.recordAmendment(id, intent.key, receipt, null);
    const signing = await this.gateway.requestVersionMandate(
      intent.allowanceId,
      receipt.version,
      intent.signingKey ?? `${intent.key}:consent`,
    );
    const recorded = await this.board.recordAmendment(id, intent.key, receipt, signing);
    return this.view(recorded, signing.status);
  }
  async recover() {
    const results: { projectId: string; status: string }[] = [];
    let after = '';
    do {
      const page = await this.board.pendingAmendments(after);
      for (const { projectId, intent } of page.items) {
        try {
          results.push({ projectId, status: (await this.deliver(projectId, intent)).status });
        } catch {
          results.push({ projectId, status: 'WAIT' });
        }
      }
      after = page.nextCursor ?? '';
    } while (after);
    return results;
  }
}
