import { createHash } from 'node:crypto';
import { completeIntakeChecked, withheldForPlanner } from '@stood/yard-contracts';
import type { Plan } from '@stood/yard-domain';
import { YardError } from '../ports/events.js';
import type { ForemanPlans } from '../ports/foreman.js';
import type { IntakeStore } from '../ports/intakes.js';
export interface IntakeRepositories {
  resolve(buyer: string, repository: string): Promise<Readonly<{ repository: string; baseCommit: string }>>;
}
// A version is a snapshot: subsequent draft edits start a different planning thread. The thread id is also the id of
// the Board project made from that plan, so erasure derives both from the intake's owner and versions.
export function intakePlanId(buyer: string, id: string, version: number): string {
  return `intake-${createHash('sha256')
    .update(JSON.stringify([buyer, id, version]))
    .digest('hex')}`;
}
export function isIntakePlanId(id: string): boolean {
  return /^intake-[a-f0-9]{64}$/.test(id);
}
export class IntakePlanner {
  constructor(
    private readonly store: IntakeStore,
    private readonly foreman: ForemanPlans,
    private readonly repositories: IntakeRepositories,
  ) {}
  async create(id: string, buyer: string, version: number, now: number): Promise<Plan> {
    const run = () => this.createLocked(id, buyer, version, now);
    return this.store.withLock ? this.store.withLock(id, run) : run();
  }
  async recover(id: string, buyer: string, version: number): Promise<Plan> {
    const run = async () => {
      if (!Number.isSafeInteger(version) || version < 1) throw new YardError('INVALID');
      await this.store.assertNotErasing?.(id);
      const record = await this.store.load(id);
      if (record.owner !== buyer) throw new YardError('FORBIDDEN');
      if (record.version !== version) throw new YardError('CONFLICT');
      const planId = intakePlanId(buyer, id, version);
      await this.store.registerPlan?.(id, buyer, version, planId);
      return this.foreman.recover(planId, buyer);
    };
    return this.store.withLock ? this.store.withLock(id, run) : run();
  }
  private async createLocked(id: string, buyer: string, version: number, now: number): Promise<Plan> {
    if (!Number.isSafeInteger(version) || version < 1 || !Number.isSafeInteger(now) || now < 0)
      throw new YardError('INVALID');
    await this.store.assertNotErasing?.(id);
    const record = await this.store.load(id);
    if (record.owner !== buyer) throw new YardError('FORBIDDEN');
    if (record.version !== version) throw new YardError('CONFLICT');
    const planId = intakePlanId(buyer, id, version);
    // Persist the reverse link before the external write so project conversion and erasure share one fence. If
    // drafting is interrupted, erasure can still safely forget this exact prospective thread.
    await this.store.registerPlan?.(id, buyer, version, planId);
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
    const plan = await this.foreman.draft({
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
    // Keep the post-write check as defense in depth for non-Postgres stores; production also holds the shared intake
    // lock for the full planning operation, so erasure cannot cross this write.
    try {
      await this.store.load(id);
    } catch (error) {
      if (error instanceof YardError && error.code === 'NOT_FOUND') {
        await this.foreman.forget?.(planId);
        throw new YardError('NOT_FOUND');
      }
      throw error;
    }
    return plan;
  }
}
