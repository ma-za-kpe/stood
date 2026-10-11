import { describe, expect, it, vi } from 'vitest';
import type { ClaimState, RunClaims } from '../ports/run-claims.js';
import { RUN_DEADLINE_MS, RUN_RENEW_MS, runClaimed } from './claimed-queue.js';

function fakeClaims(initial: Record<string, ClaimState & { held?: boolean }> = {}) {
  const rows = new Map(Object.entries(initial).map(([k, v]) => [k, { ...v }]));
  const released: [string, string | null][] = [];
  const claims: RunClaims = {
    states: async (_kind, ids) =>
      new Map(ids.flatMap((id) => (rows.has(id) ? [[id, rows.get(id) as ClaimState]] : []))),
    claim: async (_kind, id) => {
      const row = rows.get(id) ?? { attempts: 0, due: true };
      if (!row.due || row.held) return null;
      rows.set(id, { attempts: row.attempts + 1, due: false });
      return { attempts: row.attempts + 1, token: `token-${id}` };
    },
    renew: async () => true,
    release: async (_kind, id, token, waited) => {
      if (token !== `token-${id}`) throw new Error('not the owner');
      released.push([id, waited]);
      if (waited === null) rows.delete(id);
      else rows.set(id, { attempts: rows.get(id)?.attempts ?? 1, due: false });
    },
  };
  return { claims, released };
}

// Audit 2026-10-10, finding 4: two baselines stuck at the head of the queue starved every newer one.
describe('runClaimed', () => {
  it('runs untried jobs before ones that keep waiting, and skips jobs backing off', async () => {
    const h = fakeClaims({ stuck1: { attempts: 3, due: true }, stuck2: { attempts: 5, due: false } });
    const ran: string[] = [];
    const result = await runClaimed(
      h.claims,
      'baseline',
      ['stuck1', 'stuck2', 'new1', 'new2'],
      (j) => j,
      2,
      async (j) => {
        ran.push(j);
        return 'DONE';
      },
    );
    expect(ran).toEqual(['new1', 'new2']);
    expect(result).toEqual([
      { id: 'new1', outcome: 'DONE' },
      { id: 'new2', outcome: 'DONE' },
    ]);
  });

  it('never runs a job another runner holds, and records why a job waited', async () => {
    const h = fakeClaims({ busy: { attempts: 1, due: true, held: true } });
    const result = await runClaimed(
      h.claims,
      'package',
      ['busy', 'a', 'b'],
      (j) => j,
      5,
      async (j) => {
        if (j === 'b') throw new Error('boom');
        return 'WAIT:GITHUB_UNAVAILABLE';
      },
    );
    expect(result.map((r) => r.id)).toEqual(['a', 'b']);
    expect(h.released).toEqual([
      ['a', 'WAIT:GITHUB_UNAVAILABLE'],
      ['b', 'WAIT:FAILED'],
    ]);
  });

  // Second audit (2026-10-11): a long run keeps its lease, but never beyond an overall deadline.
  it('renews the lease while the run works, and stops renewing at the overall deadline', async () => {
    vi.useFakeTimers();
    try {
      const h = fakeClaims();
      const renew = vi.fn(async () => true);
      h.claims.renew = renew;
      let finish = () => {};
      const running = runClaimed(
        h.claims,
        'baseline',
        ['slow'],
        (j) => j,
        1,
        () =>
          new Promise((r) => {
            finish = () => r('DONE');
          }),
      );
      await vi.advanceTimersByTimeAsync(3 * RUN_RENEW_MS);
      expect(renew).toHaveBeenCalledTimes(3);
      expect(renew).toHaveBeenCalledWith('baseline', 'slow', 'token-slow', expect.any(Number));
      await vi.advanceTimersByTimeAsync(RUN_DEADLINE_MS);
      const calls = renew.mock.calls.length;
      await vi.advanceTimersByTimeAsync(5 * RUN_RENEW_MS);
      expect(renew.mock.calls.length).toBe(calls);
      expect(calls).toBeLessThanOrEqual(RUN_DEADLINE_MS / RUN_RENEW_MS);
      finish();
      expect(await running).toEqual([{ id: 'slow', outcome: 'DONE' }]);
    } finally {
      vi.useRealTimers();
    }
  });
});
