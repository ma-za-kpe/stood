import { YardError, type YardEvents } from '../ports/events.js';
import type { ForemanPlans } from '../ports/foreman.js';
import type { IntakeStore } from '../ports/intakes.js';
import { intakePlanId } from './intake-planner.js';

export const INTAKE_IDLE_MS = 90 * 86_400_000;
type Deps = Readonly<{
  intakes: Required<Pick<IntakeStore, 'erase' | 'idle' | 'load'>> &
    Pick<
      IntakeStore,
      'withLock' | 'assertNotErasing' | 'prepareErasure' | 'pendingErasureTargets' | 'completeErasureTarget'
    >;
  // A Board project made from the intake: erasing its events needs a reviewed approach (Y22), so it is refused.
  projects: Pick<YardEvents, 'load'>;
  foreman?: Pick<ForemanPlans, 'forget'>;
}>;

async function exists(deps: Deps, id: string) {
  try {
    await deps.projects.load(id);
    return true;
  } catch (error) {
    if (error instanceof YardError && error.code === 'NOT_FOUND') return false;
    throw error;
  }
}

// Every planning thread the intake can have: one per version, each also the id of a project made from that plan
// (fifth audit, 2026-10-11: erasure used the intake id, which names neither).
async function planIds(
  deps: Deps,
  id: string,
): Promise<Readonly<{ owner: string; updatedAt: number; ids: string[] }> | null> {
  let record: Awaited<ReturnType<IntakeStore['load']>>;
  try {
    record = await deps.intakes.load(id);
  } catch (error) {
    if (error instanceof YardError && error.code === 'NOT_FOUND') return null;
    throw error;
  }
  const ids = Array.from({ length: record.version }, (_, i) => intakePlanId(record.owner, id, i + 1));
  return { owner: record.owner, updatedAt: record.updatedAt, ids };
}

// Record exact plan targets and progress before deleting the intake. The per-intake lock fences save/planning while
// Foreman is cleaned; a failure leaves both the intake and manifest available for the next attempt.
async function erase(
  id: string,
  owner: string,
  reason: 'BUYER_REQUEST' | 'EXPIRED',
  now: number,
  deps: Deps,
  eligibleBefore?: number,
): Promise<'ERASED' | 'ALREADY' | 'PROJECT' | 'FRESH'> {
  const plans = await planIds(deps, id);
  if (plans) {
    if (plans.owner !== owner) throw new YardError('FORBIDDEN');
    if (eligibleBefore !== undefined && plans.updatedAt >= eligibleBefore) return 'FRESH';
    for (const plan of plans.ids) if (await exists(deps, plan)) return 'PROJECT';
    if (deps.intakes.prepareErasure && deps.intakes.pendingErasureTargets && deps.intakes.completeErasureTarget) {
      if (plans.ids.length && !deps.foreman?.forget) throw new Error('Foreman cleanup is unavailable');
      const prepared = await deps.intakes.prepareErasure(id, owner, reason, now, plans.ids, eligibleBefore);
      if (!prepared) return 'FRESH';
      for (const plan of await deps.intakes.pendingErasureTargets(id)) {
        await deps.foreman?.forget?.(plan);
        await deps.intakes.completeErasureTarget(id, plan);
      }
    } else if (deps.foreman?.forget) {
      for (const plan of plans.ids) await deps.foreman.forget(plan);
    }
  }
  const result = await deps.intakes.erase(id, owner, reason, now, eligibleBefore);
  // Older injected stores without the durable manifest retain the compatibility cleanup path.
  if (plans && !deps.intakes.prepareErasure && deps.foreman?.forget)
    for (const plan of plans.ids) await deps.foreman.forget(plan);
  return result;
}

// T-0217: the buyer erases their intake draft and the planner's copies of it. A draft that became a Board project is
// refused (its project events stay until erasure there is reviewed); a repeat is a no-op.
export async function eraseIntake(id: string, owner: string, now: number, deps: Deps): Promise<'ERASED' | 'ALREADY'> {
  const run = () => erase(id, owner, 'BUYER_REQUEST', now, deps);
  const result = await (deps.intakes.withLock ? deps.intakes.withLock(id, run) : run());
  if (result === 'PROJECT') throw new YardError('CONFLICT');
  if (result === 'FRESH') throw new YardError('CONFLICT');
  return result;
}

// T-0217: drafts nobody touched for 90 days are erased with the planner's copies, unless they became a Board project.
export async function expireIntakes(now: number, deps: Deps): Promise<number> {
  let erased = 0;
  const before = now - INTAKE_IDLE_MS;
  let cursor: { updatedAt: number; id: string } | undefined;
  let failures = 0;
  while (true) {
    const drafts = await deps.intakes.idle(before, 100, cursor);
    if (!drafts.length) break;
    for (const draft of drafts) {
      cursor = { updatedAt: draft.updatedAt, id: draft.id };
      try {
        const run = () => erase(draft.id, draft.owner, 'EXPIRED', now, deps, before);
        if ((await (deps.intakes.withLock ? deps.intakes.withLock(draft.id, run) : run())) === 'ERASED') erased++;
      } catch {
        // Continue past one corrupt or temporarily unavailable draft; the next run retries it.
        failures++;
      }
    }
  }
  if (failures) throw new Error(`Failed to erase ${failures} expired intake(s); remaining drafts will retry`);
  return erased;
}
