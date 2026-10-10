import { describe, expect, it, vi } from 'vitest';
import { YardError } from '../ports/events.js';
import { eraseIntake, expireIntakes, INTAKE_IDLE_MS } from './intake-erasure.js';

const now = 1791158400000;
function deps(projects: string[] = []) {
  const erased: [string, string, string][] = [];
  return {
    erased,
    forgotten: [] as string[],
    deps: {
      intakes: {
        erase: vi.fn(async (id: string, owner: string, reason: 'BUYER_REQUEST' | 'EXPIRED') => {
          erased.push([id, owner, reason]);
          return id === 'again' ? ('ALREADY' as const) : ('ERASED' as const);
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
          if (id === 'broken') throw new Error('database down');
          if (!projects.includes(id)) throw new YardError('NOT_FOUND');
          return { id, owner: 'buyer', version: 1, data: {} };
        }),
      },
      foreman: { forget: vi.fn(async () => undefined) },
    },
  };
}

// T-0217: deletion requests and intake expiry.
describe('intake erasure', () => {
  it('erases the draft and the planner copy for its owner, and refuses one that became a project', async () => {
    const d = deps(['project']);
    expect(await eraseIntake('mine', 'buyer', now, d.deps)).toBe('ERASED');
    expect(d.erased).toEqual([['mine', 'buyer', 'BUYER_REQUEST']]);
    expect(d.deps.foreman.forget).toHaveBeenCalledWith('mine');
    expect(await eraseIntake('again', 'buyer', now, d.deps)).toBe('ALREADY');
    await expect(eraseIntake('project', 'buyer', now, d.deps)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(eraseIntake('broken', 'buyer', now, d.deps)).rejects.toThrow('database down');
    const { foreman: _planner, ...withoutPlanner } = d.deps;
    expect(await eraseIntake('no-planner', 'buyer', now, withoutPlanner)).toBe('ERASED');
  });

  it('expires drafts idle for 90 days, keeping any that became a project', async () => {
    const d = deps(['project']);
    expect(await expireIntakes(now, d.deps)).toBe(1);
    expect(d.erased).toEqual([['old', 'buyer', 'EXPIRED']]);
    expect(d.deps.foreman.forget).toHaveBeenCalledWith('old');
  });
});
