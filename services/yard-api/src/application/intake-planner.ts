import { createHash } from 'node:crypto';
import { completeIntakeChecked, withheldForPlanner } from '@stood/yard-contracts';
import type { Plan } from '@stood/yard-domain';
import { YardError } from '../ports/events.js';
import type { ForemanPlans } from '../ports/foreman.js';
import type { IntakeStore } from '../ports/intakes.js';
export interface IntakeRepositories {
  resolve(buyer: string, repository: string): Promise<Readonly<{ repository: string; baseCommit: string }>>;
}
// A version is a snapshot: subsequent draft edits start a different planning thread.
export class IntakePlanner {
  constructor(
    private readonly store: IntakeStore,
    private readonly foreman: ForemanPlans,
    private readonly repositories: IntakeRepositories,
  ) {}
  async create(id: string, buyer: string, version: number, now: number): Promise<Plan> {
    if (!Number.isSafeInteger(version) || version < 1 || !Number.isSafeInteger(now) || now < 0)
      throw new YardError('INVALID');
    const record = await this.store.load(id);
    if (record.owner !== buyer) throw new YardError('FORBIDDEN');
    if (record.version !== version) throw new YardError('CONFLICT');
    const planId = `intake-${createHash('sha256')
      .update(JSON.stringify([buyer, id, version]))
      .digest('hex')}`;
    let existing: Plan | undefined;
    try {
      existing = await this.foreman.read(planId);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'NOT_FOUND')) throw error;
    }
    if (existing) {
      const context = withheldForPlanner(
        completeIntakeChecked(
          { ...record.draft, handover: { ...record.draft.handover, baseCommit: existing.blueprint.baseCommit } },
          0,
        ),
      );
      if (existing.blueprint.buyerOperatorId !== buyer || JSON.stringify(context) !== existing.intakeContext)
        throw new YardError('CONFLICT');
      return existing;
    }
    // Validate every buyer choice before contacting a repository provider. The placeholder
    // only satisfies the schema; it is replaced by an independently resolved immutable head.
    const context = completeIntakeChecked(
      { ...record.draft, handover: { ...record.draft.handover, baseCommit: '0'.repeat(40) } },
      now,
    );
    const source = await this.repositories.resolve(buyer, context.handover.repository);
    if (source.repository !== context.handover.repository) throw new YardError('CONFLICT');
    const snapshot = completeIntakeChecked(
      { ...context, handover: { ...context.handover, baseCommit: source.baseCommit } },
      now,
    );
    return this.foreman.draft({
      id: planId,
      buyerOperatorId: buyer,
      repository: source.repository,
      baseCommit: source.baseCommit,
      description: snapshot.idea.description,
      capMinor: snapshot.timing.capMinor,
      currency: snapshot.timing.currency,
      context: JSON.stringify(withheldForPlanner(snapshot)),
      createdAt: now,
    });
  }
}
