import { describe, expect, it, vi } from 'vitest';
import { YardError } from '../ports/events.js';
import { eraseIntake, expireIntakes, INTAKE_IDLE_MS } from './intake-erasure.js';
import { intakePlanId } from './intake-planner.js';

const now = 1791158400000;
// Intakes by id: owner and current version. 'gone' was erased before.
const drafts: Record<string, { owner: string; version: number }> = {
  mine: { owner: 'buyer', version: 3 },
  again: { owner: 'buyer', version: 1 },
  old: { owner: 'buyer', version: 2 },
  project: { owner: 'buyer', version: 2 },
  broken: { owner: 'buyer', version: 1 },
  'no-planner': { owner: 'buyer', version: 1 },
};
function deps(projects: string[] = []) {
  const erased: [string, string, string][] = [];
  const forgotten: string[] = [];
  return {
    erased,
    forgotten,
    deps: {
      intakes: {
        load: vi.fn(async (id: string) => {
          const d = drafts[id];
          if (!d) throw new YardError('NOT_FOUND');
          return { id, owner: d.owner, version: d.version, draft: {} } as never;
        }),
        erase: vi.fn(async (id: string, owner: string, reason: 'BUYER_REQUEST' | 'EXPIRED') => {
          erased.push([id, owner, reason]);
          return id === 'again' || id === 'gone' ? ('ALREADY' as const) : ('ERASED' as const);
        }),
        idle: vi.fn(async (before: number) => {
          expect(before).toBe(now - INTAKE_IDLE_MS);
          return [
            { id: 'old', owner: 'buyer' },
            { id: 'project', owner: 'buyer' },
          ];
        }),
      },
      projects: {
        load: vi.fn(async (id: string) => {
          if (id === intakePlanId('buyer', 'broken', 1)) throw new Error('database down');
          if (!projects.includes(id)) throw new YardError('NOT_FOUND');
          return { id, owner: 'buyer', version: 1, data: {} };
        }),
      },
      foreman: {
        forget: vi.fn(async (id: string) => {
          forgotten.push(id);
        }),
      },
    },
  };
}

// T-0217: deletion requests and intake expiry. Fifth audit (2026-10-11): the planner keeps one thread per intake
// version, named by intakePlanId, and a project made from a plan carries that same id.
describe('intake erasure', () => {
  it("forgets the planner's thread for every version before erasing the draft", async () => {
    const d = deps();
    expect(await eraseIntake('mine', 'buyer', now, d.deps)).toBe('ERASED');
    const ids = [1, 2, 3].map((v) => intakePlanId('buyer', 'mine', v));
    // Forgotten before the draft goes, and again after it (the deletion fence with planning).
    expect(d.forgotten).toEqual([...ids, ...ids]);
    expect(d.forgotten).not.toContain('mine');
    expect(d.erased).toEqual([['mine', 'buyer', 'BUYER_REQUEST']]);
    const order = d.deps.foreman.forget.mock.invocationCallOrder;
    const erasedAt = d.deps.intakes.erase.mock.invocationCallOrder[0] ?? 0;
    expect(order.slice(0, 3).every((at) => at < erasedAt)).toBe(true);
    expect(order.slice(3).every((at) => at > erasedAt)).toBe(true);
  });

  it('refuses a draft whose plan became a project, by the plan id, and touches nothing', async () => {
    const d = deps([intakePlanId('buyer', 'project', 2)]);
    await expect(eraseIntake('project', 'buyer', now, d.deps)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(d.forgotten).toEqual([]);
    expect(d.erased).toEqual([]);
  });

  it("refuses another buyer's draft before forgetting anything", async () => {
    const d = deps();
    await expect(eraseIntake('mine', 'someone-else', now, d.deps)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(d.forgotten).toEqual([]);
  });

  it('repeats, store failures and a missing planner', async () => {
    const d = deps();
    expect(await eraseIntake('again', 'buyer', now, d.deps)).toBe('ALREADY');
    expect(await eraseIntake('gone', 'buyer', now, d.deps)).toBe('ALREADY');
    await expect(eraseIntake('broken', 'buyer', now, d.deps)).rejects.toThrow('database down');
    const { foreman: _planner, ...withoutPlanner } = d.deps;
    expect(await eraseIntake('no-planner', 'buyer', now, withoutPlanner)).toBe('ERASED');
  });

  it("expires drafts idle for 90 days with their planner's threads, keeping any that became a project", async () => {
    const d = deps([intakePlanId('buyer', 'project', 1)]);
    expect(await expireIntakes(now, d.deps)).toBe(1);
    expect(d.erased).toEqual([['old', 'buyer', 'EXPIRED']]);
    const ids = [1, 2].map((v) => intakePlanId('buyer', 'old', v));
    expect(d.forgotten).toEqual([...ids, ...ids]);
  });
});
