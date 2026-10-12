import { YardError } from '../ports/events.js';
import type { BoardContext } from './board-context.js';
import {
  beforeDeadline,
  data,
  fingerprint,
  leaseChange,
  type Operator,
  open,
  type SubmissionIntent,
  same,
  status,
  workOrder,
} from './board-state.js';

export class BoardSubmissions {
  constructor(private readonly context: BoardContext) {}
  async pendingSubmissions(after = '') {
    const projects = await this.context.events.list(after),
      page = projects.slice(0, 100);
    const submissions = page.flatMap((project) =>
      Object.entries(data(project.data).orders).flatMap(([wo, order]) =>
        order.submissionIntent?.status === 'RESERVED'
          ? [{ projectId: project.id, wo, intent: structuredClone(order.submissionIntent) }]
          : [],
      ),
    );
    return { submissions, nextCursor: projects.length > 100 ? page.at(-1)!.id : null };
  }
  async prepareSubmission(
    id: string,
    wo: string,
    commit: string,
    actor: Operator,
    version: number,
    key: string,
    now: number,
  ): Promise<SubmissionIntent> {
    const current = await this.context.read(id, actor);
    const existing = workOrder(data(current.data), wo).order.submissionIntent;
    if (existing) {
      if (
        existing.key !== key ||
        existing.request.commit !== commit ||
        existing.expectedVersion !== version ||
        existing.actor.id !== actor.id ||
        existing.actor.root !== actor.root ||
        existing.actor.kind !== actor.kind
      )
        throw new YardError('CONFLICT');
      return structuredClone(existing);
    }
    const snapshot = await this.context.mutate(
      id,
      actor,
      version,
      `submission-reserve:${key}`,
      { wo, commit, actor, version, key },
      'submission.reserved',
      (d) => {
        const { work, order } = workOrder(d, wo);
        const claim = work.snapshot.currentClaim;
        if (actor.kind !== 'BUILDER' || claim?.builderId !== actor.id || order.payment || order.submissionIntent)
          throw new YardError('FORBIDDEN');
        open(order);
        beforeDeadline(d, order.milestone, now);
        leaseChange(() => work.submit(claim.id, commit, 'reservation-only', now)); // validate lease and commit before any HTTP
        order.submissionIntent = {
          key,
          actor: structuredClone(actor),
          claimId: claim.id,
          expectedVersion: version,
          reservedVersion: version + 1,
          request: {
            trancheId: order.trancheId,
            repository: d.blueprint.repository,
            baseCommit: d.blueprint.baseCommit,
            commit,
            key: `yard:${fingerprint({ id, wo, actor, claim: claim.id, commit, key })}`,
          },
          requestedAt: now,
          status: 'RESERVED',
          packageId: null,
          completedVersion: null,
        };
        return { wo, state: 'SUBMITTING', simulated: true };
      },
    );
    return structuredClone(workOrder(data(snapshot.data), wo).order.submissionIntent!);
  }
  completeSubmission(id: string, wo: string, intent: SubmissionIntent, packageId: string) {
    return this.context.atCurrent(id, (version) =>
      this.context.mutate(
        id,
        intent.actor,
        version,
        `submission-complete:${intent.key}`,
        {
          wo,
          requestKey: intent.request.key,
          claimId: intent.claimId,
          originalVersion: intent.expectedVersion,
          packageId,
        },
        'wo.submitted',
        (d) => {
          const { work, order } = workOrder(d, wo);
          if (
            !same(order.submissionIntent, intent) ||
            work.snapshot.currentClaim?.id !== intent.claimId ||
            order.payment
          )
            throw new YardError('CONFLICT');
          work.submit(intent.claimId, intent.request.commit, packageId, intent.requestedAt);
          work.checking(packageId, intent.requestedAt);
          order.actions.push({
            kind: 'submit',
            claim: intent.claimId,
            commit: intent.request.commit,
            packageId,
            now: intent.requestedAt,
          });
          order.submissionIntent = {
            ...intent,
            status: 'CONFIRMED',
            packageId,
            completedVersion: version + 1,
          };
          return { wo, state: 'CHECKING', packageId, simulated: true };
        },
      ),
    );
  }
  async submissionTerms(
    id: string,
    wo: string,
    actor: Operator,
    commit: string,
    version: number,
    key: string,
    now: number,
  ) {
    const snapshot = await this.context.read(id, actor);
    const d = data(snapshot.data);
    const { work, order } = workOrder(d, wo);
    if (actor.kind !== 'BUILDER' || work.snapshot.currentClaim?.builderId !== actor.id)
      throw new YardError('FORBIDDEN');
    if (work.snapshot.state !== 'BUILDING') {
      const packageId = work.snapshot.submission?.packageId;
      if (!packageId) throw new YardError('FORBIDDEN');
      try {
        return { receipt: await this.context.submit(id, wo, commit, packageId, actor, version, key, now) };
      } catch (error) {
        if (error instanceof YardError) throw error;
        throw new YardError('FORBIDDEN');
      }
    }
    if (snapshot.version !== version) throw new YardError('STALE_VERSION');
    return { trancheId: order.trancheId, repository: d.blueprint.repository, baseCommit: d.blueprint.baseCommit };
  }
  // Only an authenticated Stood integration calls this after matching provider-backed read proof.
}
