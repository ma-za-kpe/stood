import { YardError, type YardEvents } from '../ports/events.js';
import type { ForemanPlans } from '../ports/foreman.js';
import type { IntakeStore } from '../ports/intakes.js';

export const INTAKE_IDLE_MS = 90 * 86_400_000;
type Deps = Readonly<{
  intakes: Required<Pick<IntakeStore, 'erase' | 'idle'>>;
  // A Board project made from the intake: erasing its events needs a reviewed approach (Y22), so it is refused.
  projects: Pick<YardEvents, 'load'>;
  foreman?: Pick<ForemanPlans, 'forget'>;
}>;

async function hasProject(deps: Deps, id: string) {
  try {
    await deps.projects.load(id);
    return true;
  } catch (error) {
    if (error instanceof YardError && error.code === 'NOT_FOUND') return false;
    throw error;
  }
}

// T-0217: the buyer erases their intake draft and the planner's copy of it. A draft that became a Board project is
// refused (its project events stay until erasure there is reviewed); a repeat is a no-op.
export async function eraseIntake(id: string, owner: string, now: number, deps: Deps): Promise<'ERASED' | 'ALREADY'> {
  if (await hasProject(deps, id)) throw new YardError('CONFLICT');
  const result = await deps.intakes.erase(id, owner, 'BUYER_REQUEST', now);
  await deps.foreman?.forget?.(id);
  return result;
}

// T-0217: drafts nobody touched for 90 days are erased, unless they became a Board project.
export async function expireIntakes(now: number, deps: Deps): Promise<number> {
  let erased = 0;
  for (const draft of await deps.intakes.idle(now - INTAKE_IDLE_MS)) {
    if (await hasProject(deps, draft.id)) continue;
    if ((await deps.intakes.erase(draft.id, draft.owner, 'EXPIRED', now)) === 'ERASED') erased++;
    await deps.foreman?.forget?.(draft.id);
  }
  return erased;
}
