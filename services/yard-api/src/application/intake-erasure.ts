import { YardError, type YardEvents } from '../ports/events.js';
import type { ForemanPlans } from '../ports/foreman.js';
import type { IntakeStore } from '../ports/intakes.js';
import { intakePlanId } from './intake-planner.js';

export const INTAKE_IDLE_MS = 90 * 86_400_000;
type Deps = Readonly<{
  intakes: Required<Pick<IntakeStore, 'erase' | 'idle'>> & Pick<IntakeStore, 'load'>;
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
async function planIds(deps: Deps, id: string): Promise<Readonly<{ owner: string; ids: string[] }> | null> {
  let record: Awaited<ReturnType<IntakeStore['load']>>;
  try {
    record = await deps.intakes.load(id);
  } catch (error) {
    if (error instanceof YardError && error.code === 'NOT_FOUND') return null;
    throw error;
  }
  const ids = Array.from({ length: record.version }, (_, i) => intakePlanId(record.owner, id, i + 1));
  return { owner: record.owner, ids };
}

// The planner's copies go first: erasing the intake removes the versions they are derived from, and forgetting is
// idempotent, so a crash between the two is finished by a retry. They are forgotten again after the erase (the fence).
async function erase(
  id: string,
  owner: string,
  reason: 'BUYER_REQUEST' | 'EXPIRED',
  now: number,
  deps: Deps,
): Promise<'ERASED' | 'ALREADY' | 'PROJECT'> {
  const plans = await planIds(deps, id);
  if (plans) {
    if (plans.owner !== owner) throw new YardError('FORBIDDEN');
    for (const plan of plans.ids) if (await exists(deps, plan)) return 'PROJECT';
    if (deps.foreman?.forget) for (const plan of plans.ids) await deps.foreman.forget(plan);
  }
  const result = await deps.intakes.erase(id, owner, reason, now);
  // Sixth audit (2026-10-11), the other half of the deletion fence: a plan written while the draft was being erased
  // is forgotten here, and one written after the draft is gone is forgotten by the planner's own re-check.
  if (plans && deps.foreman?.forget) for (const plan of plans.ids) await deps.foreman.forget(plan);
  return result;
}

// T-0217: the buyer erases their intake draft and the planner's copies of it. A draft that became a Board project is
// refused (its project events stay until erasure there is reviewed); a repeat is a no-op.
export async function eraseIntake(id: string, owner: string, now: number, deps: Deps): Promise<'ERASED' | 'ALREADY'> {
  const result = await erase(id, owner, 'BUYER_REQUEST', now, deps);
  if (result === 'PROJECT') throw new YardError('CONFLICT');
  return result;
}

// T-0217: drafts nobody touched for 90 days are erased with the planner's copies, unless they became a Board project.
export async function expireIntakes(now: number, deps: Deps): Promise<number> {
  let erased = 0;
  for (const draft of await deps.intakes.idle(now - INTAKE_IDLE_MS))
    if ((await erase(draft.id, draft.owner, 'EXPIRED', now, deps)) === 'ERASED') erased++;
  return erased;
}
