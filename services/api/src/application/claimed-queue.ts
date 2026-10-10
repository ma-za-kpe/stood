import type { RunClaims, RunKind } from '../ports/run-claims.js';

// Long enough for the slowest run (a ten-minute sandbox) to finish before another runner may take the job over.
export const RUN_LEASE_MS = 15 * 60_000;

// Audit 2026-10-10, finding 4: runs up to `limit` due jobs, fewest attempts first (oldest first among equals), each
// under a claim. Two stuck jobs at the head of the queue no longer block every job behind them, and a job another
// runner is running is skipped, not run twice.
export async function runClaimed<J>(
  claims: RunClaims,
  kind: RunKind,
  queue: readonly J[],
  idOf: (job: J) => string,
  limit: number,
  run: (job: J) => Promise<string>,
): Promise<readonly Readonly<{ id: string; outcome: string }>[]> {
  const states = await claims.states(kind, queue.map(idOf));
  const due = queue
    .map((job, age) => ({ job, age, state: states.get(idOf(job)) }))
    .filter((c) => c.state?.due ?? true)
    .sort((a, b) => (a.state?.attempts ?? 0) - (b.state?.attempts ?? 0) || a.age - b.age);
  const done: { id: string; outcome: string }[] = [];
  for (const { job } of due) {
    if (done.length >= limit) break;
    const id = idOf(job);
    if ((await claims.claim(kind, id, RUN_LEASE_MS)) === null) continue;
    const outcome = await run(job).catch(() => 'WAIT:FAILED');
    await claims.release(kind, id, outcome.startsWith('WAIT') ? outcome : null);
    done.push({ id, outcome });
  }
  return done;
}
